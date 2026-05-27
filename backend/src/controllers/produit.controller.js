import pkg from '@prisma/client';
const { Role, TypeProduit } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * ProduitController
 * Gère les opérations CRUD sur les produits avec isolation multi-tenant.
 *
 * Un produit appartient strictement à une boutique (tenantId).
 * La référence est unique par boutique (contrainte @@unique([tenantId, reference])).
 * Chaque variation de stock est tracée dans MouvementStock.
 * Toutes les requêtes sont filtrées par tenantId sauf pour le SUPER_ADMIN.
 */
class ProduitController {

    // ============================================================
    // CREATE — Créer un nouveau produit
    // Accès : ADMIN
    // POST /api/produits
    // ============================================================
    static async create(req, res) {
        try {
            const {
                reference,
                type,
                marque,
                prixAchat,
                prixVente,
                quantiteEnStock = 0,
                fournisseurId
            } = req.body;

            // -- Validation des champs obligatoires --
            if (!reference || !reference.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ reference est obligatoire.'
                });
            }

            if (!type) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ type est obligatoire.'
                });
            }

            // -- Validation du type produit --
            const typesValides = Object.values(TypeProduit);
            if (!typesValides.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: `Type de produit invalide. Types autorisés : ${typesValides.join(', ')}.`
                });
            }

            // -- Validation des prix --
            if (prixAchat === undefined || prixAchat === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ prixAchat est obligatoire.'
                });
            }

            if (prixVente === undefined || prixVente === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ prixVente est obligatoire.'
                });
            }

            if (Number(prixAchat) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le prixAchat ne peut pas être négatif.'
                });
            }

            if (Number(prixVente) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le prixVente ne peut pas être négatif.'
                });
            }

            if (Number(quantiteEnStock) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La quantiteEnStock ne peut pas être négative.'
                });
            }

            // -- Unicité de la référence dans la boutique --
            const referenceDupliquee = await prisma.produit.findUnique({
                where: {
                    tenantId_reference: {
                        tenantId: req.user.tenantId,
                        reference: reference.trim().toUpperCase()
                    }
                }
            });

            if (referenceDupliquee) {
                return res.status(409).json({
                    success: false,
                    message: `La référence "${reference.trim().toUpperCase()}" existe déjà dans cette boutique.`
                });
            }

            // -- Vérification fournisseur (s'il est fourni) --
            if (fournisseurId) {
                const fournisseurExiste = await prisma.fournisseur.findFirst({
                    where: { fournisseurId, tenantId: req.user.tenantId }
                });

                if (!fournisseurExiste) {
                    return res.status(404).json({
                        success: false,
                        message: 'Fournisseur non trouvé dans cette boutique.'
                    });
                }
            }

            // -- Création du produit --
            const produit = await prisma.produit.create({
                data: {
                    reference: reference.trim().toUpperCase(),
                    type,
                    marque: marque ? marque.trim() : null,
                    prixAchat: Number(prixAchat),
                    prixVente: Number(prixVente),
                    quantiteEnStock: Number(quantiteEnStock),
                    tenantId: req.user.tenantId,
                    fournisseurId: fournisseurId || null
                },
                select: {
                    id: true,
                    produitId: true,
                    reference: true,
                    type: true,
                    marque: true,
                    prixAchat: true,
                    prixVente: true,
                    quantiteEnStock: true,
                    tenantId: true,
                    fournisseurId: true,
                    fournisseur: {
                        select: { fournisseurId: true, nom: true, contact: true }
                    }
                }
            });

            // -- Mouvement de stock initial si quantité > 0 --
            if (Number(quantiteEnStock) > 0) {
                await prisma.mouvementStock.create({
                    data: {
                        tenantId: req.user.tenantId,
                        produitId: produit.produitId,
                        userId: req.user.userId,
                        type: 'ENTREE',
                        quantite: Number(quantiteEnStock),
                        quantiteAvant: 0,
                        quantiteApres: Number(quantiteEnStock),
                        motif: 'Stock initial à la création du produit'
                    }
                });
            }

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: req.user.tenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'Produit',
                    entiteId: produit.produitId,
                    nouvellesValeurs: {
                        reference: produit.reference,
                        type: produit.type,
                        marque: produit.marque,
                        prixAchat: produit.prixAchat,
                        prixVente: produit.prixVente,
                        quantiteEnStock: produit.quantiteEnStock
                    }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Produit créé avec succès.',
                data: produit
            });

        } catch (error) {
            console.error('Erreur lors de la création du produit :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du produit.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET ALL — Lister les produits
    // Accès : Tous les rôles (filtrés par tenant sauf SUPER_ADMIN)
    // GET /api/produits
    // Query : page, limit, search, type, fournisseurId,
    //         stockBas, sortBy, order
    // ============================================================
    static async getAll(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                search,
                type,
                fournisseurId,
                stockBas,        // 'true' → produits dont quantiteEnStock = 0
                sortBy = 'reference',
                order = 'asc'
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Filtre de recherche plein-texte --
            const searchFilter = search
                ? {
                    OR: [
                        { reference: { contains: search, mode: 'insensitive' } },
                        { marque: { contains: search, mode: 'insensitive' } }
                    ]
                }
                : {};

            // -- Filtre type --
            const typeFilter = type && Object.values(TypeProduit).includes(type)
                ? { type }
                : {};

            // -- Filtre fournisseur --
            const fournisseurFilter = fournisseurId
                ? { fournisseurId }
                : {};

            // -- Filtre stock bas (rupture) --
            const stockFilter = stockBas === 'true'
                ? { quantiteEnStock: 0 }
                : {};

            // -- Tri sécurisé --
            const champsAutorises = ['reference', 'marque', 'prixVente', 'prixAchat', 'quantiteEnStock', 'type'];
            const sortField = champsAutorises.includes(sortBy) ? sortBy : 'reference';
            const sortOrder = order === 'desc' ? 'desc' : 'asc';

            const whereClause = {
                ...tenantFilter,
                ...searchFilter,
                ...typeFilter,
                ...fournisseurFilter,
                ...stockFilter
            };

            const [produits, total] = await Promise.all([
                prisma.produit.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        produitId: true,
                        reference: true,
                        type: true,
                        marque: true,
                        prixAchat: true,
                        prixVente: true,
                        quantiteEnStock: true,
                        tenantId: true,
                        fournisseurId: true,
                        fournisseur: {
                            select: { fournisseurId: true, nom: true }
                        },
                        _count: {
                            select: {
                                lignesVente: true,
                                lignesDevis: true,
                                mouvements: true
                            }
                        }
                    },
                    orderBy: { [sortField]: sortOrder }
                }),
                prisma.produit.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: produits,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des produits :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des produits.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET BY ID — Détails d'un produit
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/produits/:produitId
    // ============================================================
    static async getById(req, res) {
        try {
            const { produitId } = req.params;

            const produit = await prisma.produit.findFirst({
                where: {
                    produitId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                select: {
                    id: true,
                    produitId: true,
                    reference: true,
                    type: true,
                    marque: true,
                    prixAchat: true,
                    prixVente: true,
                    quantiteEnStock: true,
                    tenantId: true,
                    fournisseurId: true,
                    fournisseur: {
                        select: { fournisseurId: true, nom: true, contact: true }
                    },
                    _count: {
                        select: {
                            lignesVente: true,
                            lignesDevis: true,
                            lignesRetour: true,
                            mouvements: true
                        }
                    }
                }
            });

            if (!produit) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé.'
                });
            }

            return res.status(200).json({
                success: true,
                data: produit
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du produit :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du produit.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // UPDATE — Modifier un produit (infos commerciales uniquement)
    // Accès : ADMIN
    // PATCH /api/produits/:produitId
    //
    // ⚠️  Le stock NE se modifie PAS ici.
    //     Utiliser POST /api/produits/:produitId/stock pour tout
    //     ajustement de quantité (traçabilité MouvementStock obligatoire).
    // ============================================================
    static async update(req, res) {
        try {
            const { produitId } = req.params;
            const { reference, type, marque, prixAchat, prixVente, fournisseurId } = req.body;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.produit.findFirst({
                where: {
                    produitId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé.'
                });
            }

            // -- Validation du type si fourni --
            if (type !== undefined) {
                const typesValides = Object.values(TypeProduit);
                if (!typesValides.includes(type)) {
                    return res.status(400).json({
                        success: false,
                        message: `Type invalide. Types autorisés : ${typesValides.join(', ')}.`
                    });
                }
            }

            // -- Validation des prix si fournis --
            if (prixAchat !== undefined && Number(prixAchat) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le prixAchat ne peut pas être négatif.'
                });
            }

            if (prixVente !== undefined && Number(prixVente) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le prixVente ne peut pas être négatif.'
                });
            }

            // -- Vérification unicité de la nouvelle référence --
            if (reference !== undefined && reference.trim().toUpperCase() !== existing.reference) {
                const referenceDupliquee = await prisma.produit.findUnique({
                    where: {
                        tenantId_reference: {
                            tenantId: existing.tenantId,
                            reference: reference.trim().toUpperCase()
                        }
                    }
                });

                if (referenceDupliquee) {
                    return res.status(409).json({
                        success: false,
                        message: `La référence "${reference.trim().toUpperCase()}" existe déjà dans cette boutique.`
                    });
                }
            }

            // -- Vérification fournisseur si fourni --
            if (fournisseurId !== undefined && fournisseurId !== null) {
                const fournisseurExiste = await prisma.fournisseur.findFirst({
                    where: { fournisseurId, tenantId: existing.tenantId }
                });

                if (!fournisseurExiste) {
                    return res.status(404).json({
                        success: false,
                        message: 'Fournisseur non trouvé dans cette boutique.'
                    });
                }
            }

            // -- Construction des données à mettre à jour --
            const updateData = {};
            if (reference !== undefined) updateData.reference = reference.trim().toUpperCase();
            if (type !== undefined) updateData.type = type;
            if (marque !== undefined) updateData.marque = marque ? marque.trim() : null;
            if (prixAchat !== undefined) updateData.prixAchat = Number(prixAchat);
            if (prixVente !== undefined) updateData.prixVente = Number(prixVente);
            if (fournisseurId !== undefined) updateData.fournisseurId = fournisseurId || null;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune donnée à mettre à jour.'
                });
            }

            // -- Mise à jour --
            const updated = await prisma.produit.update({
                where: { produitId },
                data: updateData,
                select: {
                    id: true,
                    produitId: true,
                    reference: true,
                    type: true,
                    marque: true,
                    prixAchat: true,
                    prixVente: true,
                    quantiteEnStock: true,
                    tenantId: true,
                    fournisseur: {
                        select: { fournisseurId: true, nom: true, contact: true }
                    }
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'MODIFICATION',
                    modele: 'Produit',
                    entiteId: produitId,
                    anciennesValeurs: {
                        reference: existing.reference,
                        type: existing.type,
                        marque: existing.marque,
                        prixAchat: existing.prixAchat,
                        prixVente: existing.prixVente,
                        fournisseurId: existing.fournisseurId
                    },
                    nouvellesValeurs: updateData
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Produit mis à jour avec succès.',
                data: updated
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour du produit :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du produit.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // DELETE — Supprimer un produit
    // Accès : ADMIN, SUPER_ADMIN
    // DELETE /api/produits/:produitId
    //
    // ⚠️  Bloqué si le produit apparaît dans des lignes de vente,
    //     de devis ou de retour (intégrité commerciale).
    // ============================================================
    static async delete(req, res) {
        try {
            const { produitId } = req.params;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.produit.findFirst({
                where: {
                    produitId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    _count: {
                        select: {
                            lignesVente: true,
                            lignesDevis: true,
                            lignesRetour: true
                        }
                    }
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé.'
                });
            }

            // -- Blocage si le produit a un historique commercial --
            const totalUtilisation =
                existing._count.lignesVente +
                existing._count.lignesDevis +
                existing._count.lignesRetour;

            if (totalUtilisation > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Impossible de supprimer ce produit : il est référencé dans des ventes, devis ou retours.',
                    details: {
                        lignesVente: existing._count.lignesVente,
                        lignesDevis: existing._count.lignesDevis,
                        lignesRetour: existing._count.lignesRetour
                    }
                });
            }

            // -- Suppression --
            await prisma.produit.delete({ where: { produitId } });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'SUPPRESSION',
                    modele: 'Produit',
                    entiteId: produitId,
                    anciennesValeurs: {
                        reference: existing.reference,
                        type: existing.type,
                        marque: existing.marque,
                        prixAchat: existing.prixAchat,
                        prixVente: existing.prixVente,
                        quantiteEnStock: existing.quantiteEnStock
                    },
                    nouvellesValeurs: null
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Produit supprimé avec succès.'
            });

        } catch (error) {
            console.error('Erreur lors de la suppression du produit :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du produit.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // AJUSTER STOCK — Entrée / Sortie / Ajustement manuel
    // Accès : ADMIN, VENDEUR (ENTREE/AJUSTEMENT), MONTEUR (ENTREE)
    // POST /api/produits/:produitId/stock
    // ============================================================
    static async ajusterStock(req, res) {
        try {
            const { produitId } = req.params;
            const { typeMouvement, quantite, motif } = req.body;

            // -- Validation des champs obligatoires --
            if (!typeMouvement) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ typeMouvement est obligatoire.'
                });
            }

            const typesValides = ['ENTREE', 'SORTIE', 'AJUSTEMENT'];
            if (!typesValides.includes(typeMouvement)) {
                return res.status(400).json({
                    success: false,
                    message: `typeMouvement invalide. Valeurs acceptées : ${typesValides.join(', ')}.`
                });
            }

            if (quantite === undefined || quantite === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ quantite est obligatoire.'
                });
            }

            const quantiteNum = Number(quantite);

            if (!Number.isInteger(quantiteNum) || quantiteNum <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La quantite doit être un entier strictement positif.'
                });
            }

            // -- Vérification existence + isolation tenant --
            const produit = await prisma.produit.findFirst({
                where: {
                    produitId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!produit) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé.'
                });
            }

            const quantiteAvant = produit.quantiteEnStock;

            // -- Calcul de la nouvelle quantité selon le type --
            let quantiteApres;
            if (typeMouvement === 'ENTREE') {
                quantiteApres = quantiteAvant + quantiteNum;
            } else if (typeMouvement === 'SORTIE') {
                quantiteApres = quantiteAvant - quantiteNum;
                if (quantiteApres < 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Stock insuffisant. Stock actuel : ${quantiteAvant}, quantité demandée : ${quantiteNum}.`,
                        stockActuel: quantiteAvant
                    });
                }
            } else {
                // AJUSTEMENT : la quantite représente la nouvelle valeur absolue
                quantiteApres = quantiteNum;
            }

            // -- Transaction atomique : mise à jour stock + mouvement --
            const [produitMisAJour, mouvement] = await prisma.$transaction([
                prisma.produit.update({
                    where: { produitId },
                    data: { quantiteEnStock: quantiteApres },
                    select: {
                        id: true,
                        produitId: true,
                        reference: true,
                        type: true,
                        marque: true,
                        prixVente: true,
                        quantiteEnStock: true
                    }
                }),
                prisma.mouvementStock.create({
                    data: {
                        tenantId: produit.tenantId,
                        produitId: produit.produitId,
                        userId: req.user.userId,
                        type: typeMouvement,
                        quantite: quantiteNum,
                        quantiteAvant,
                        quantiteApres,
                        motif: motif ? motif.trim() : null
                    }
                })
            ]);

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: produit.tenantId,
                    userId: req.user.userId,
                    action: 'CHANGEMENT_STATUT',
                    modele: 'Produit',
                    entiteId: produitId,
                    anciennesValeurs: { quantiteEnStock: quantiteAvant },
                    nouvellesValeurs: {
                        quantiteEnStock: quantiteApres,
                        typeMouvement,
                        quantite: quantiteNum,
                        motif
                    }
                }
            });

            return res.status(200).json({
                success: true,
                message: `Mouvement de stock enregistré avec succès (${typeMouvement}).`,
                data: {
                    produit: produitMisAJour,
                    mouvement: {
                        mouvementId: mouvement.mouvementId,
                        type: mouvement.type,
                        quantite: mouvement.quantite,
                        quantiteAvant: mouvement.quantiteAvant,
                        quantiteApres: mouvement.quantiteApres,
                        motif: mouvement.motif,
                        createdAt: mouvement.createdAt
                    }
                }
            });

        } catch (error) {
            console.error('Erreur lors de l\'ajustement du stock :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'ajustement du stock.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET MOUVEMENTS — Historique des mouvements de stock
    // Accès : ADMIN, VENDEUR
    // GET /api/produits/:produitId/mouvements
    // ============================================================
    static async getMouvements(req, res) {
        try {
            const { produitId } = req.params;
            const {
                page = 1,
                limit = 20,
                typeMouvement,
                dateDebut,
                dateFin
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // -- Vérification existence + isolation tenant --
            const produit = await prisma.produit.findFirst({
                where: {
                    produitId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!produit) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé.'
                });
            }

            // -- Filtres optionnels --
            const typesValides = ['ENTREE', 'SORTIE', 'AJUSTEMENT'];
            const typeFilter = typeMouvement && typesValides.includes(typeMouvement)
                ? { type: typeMouvement }
                : {};

            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);

            const whereClause = {
                produitId,
                tenantId: produit.tenantId,
                ...typeFilter,
                ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
            };

            const [mouvements, total] = await Promise.all([
                prisma.mouvementStock.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        mouvementId: true,
                        type: true,
                        quantite: true,
                        quantiteAvant: true,
                        quantiteApres: true,
                        motif: true,
                        createdAt: true,
                        utilisateur: {
                            select: { userId: true, nom: true, role: true }
                        },
                        vente: {
                            select: { venteId: true, dateCreation: true }
                        },
                        retour: {
                            select: { retourId: true, dateRetour: true }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }),
                prisma.mouvementStock.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: {
                    produit: {
                        produitId: produit.produitId,
                        reference: produit.reference,
                        quantiteEnStock: produit.quantiteEnStock
                    },
                    mouvements
                },
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des mouvements :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des mouvements de stock.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET STATS — Statistiques d'un produit
    // Accès : ADMIN, VENDEUR
    // GET /api/produits/:produitId/stats
    // ============================================================
    static async getStats(req, res) {
        try {
            const { produitId } = req.params;

            // -- Vérification existence + isolation tenant --
            const produit = await prisma.produit.findFirst({
                where: {
                    produitId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!produit) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé.'
                });
            }

            const tenantId = produit.tenantId;

            // -- Agrégats en parallèle --
            const [
                totalVendu,
                chiffreAffaires,
                totalMouvements,
                mouvementsParType,
                derniereVente,
                totalDevisInclus,
                totalRetours
            ] = await Promise.all([
                // Quantité totale vendue (somme des lignes de vente)
                prisma.ligneVente.aggregate({
                    where: { produitId, vente: { tenantId } },
                    _sum: { quantite: true }
                }),
                // Chiffre d'affaires généré (quantité × prix unitaire figé)
                prisma.ligneVente.findMany({
                    where: { produitId, vente: { tenantId } },
                    select: { quantite: true, prixUnitaire: true }
                }),
                // Total des mouvements de stock
                prisma.mouvementStock.count({ where: { produitId, tenantId } }),
                // Répartition des mouvements par type
                prisma.mouvementStock.groupBy({
                    by: ['type'],
                    where: { produitId, tenantId },
                    _sum: { quantite: true }
                }),
                // Dernière vente incluant ce produit
                prisma.ligneVente.findFirst({
                    where: { produitId, vente: { tenantId } },
                    orderBy: { vente: { dateCreation: 'desc' } },
                    select: {
                        quantite: true,
                        prixUnitaire: true,
                        vente: {
                            select: {
                                venteId: true,
                                dateCreation: true,
                                statut: true,
                                patient: {
                                    select: { nomComplet: true }
                                }
                            }
                        }
                    }
                }),
                // Nombre de devis où ce produit apparaît
                prisma.ligneDevis.count({ where: { produitId, devis: { tenantId } } }),
                // Quantité totale retournée
                prisma.ligneRetour.aggregate({
                    where: { produitId, retour: { tenantId } },
                    _sum: { quantite: true }
                })
            ]);

            // -- Calcul du chiffre d'affaires brut --
            const chiffreAffairesBrut = chiffreAffaires.reduce(
                (sum, ligne) => sum + (ligne.quantite * ligne.prixUnitaire),
                0
            );

            // -- Formatage des mouvements par type --
            const mouvementsMap = mouvementsParType.reduce((acc, item) => {
                acc[item.type] = item._sum.quantite || 0;
                return acc;
            }, {});

            // -- Calcul de la marge --
            const margeUnitaire = produit.prixVente - produit.prixAchat;
            const margePourcent = produit.prixAchat > 0
                ? ((margeUnitaire / produit.prixAchat) * 100).toFixed(2)
                : null;

            return res.status(200).json({
                success: true,
                data: {
                    stock: {
                        quantiteActuelle: produit.quantiteEnStock,
                        valeurStockAchat: produit.quantiteEnStock * produit.prixAchat,
                        valeurStockVente: produit.quantiteEnStock * produit.prixVente
                    },
                    prix: {
                        prixAchat: produit.prixAchat,
                        prixVente: produit.prixVente,
                        margeUnitaire,
                        margePourcent: margePourcent ? Number(margePourcent) : null
                    },
                    ventes: {
                        quantiteTotaleVendue: totalVendu._sum.quantite || 0,
                        chiffreAffairesBrut,
                        derniereVente
                    },
                    devis: {
                        totalDevisInclus
                    },
                    retours: {
                        quantiteTotaleRetournee: totalRetours._sum.quantite || 0
                    },
                    mouvementsStock: {
                        total: totalMouvements,
                        parType: mouvementsMap
                    }
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques du produit.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // SEARCH — Recherche avancée multi-critères
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/produits/search
    // ============================================================
    static async search(req, res) {
        try {
            const {
                q,             // terme libre (reference, marque)
                type,          // TypeProduit
                prixMin,
                prixMax,
                enStock,       // 'true' → quantiteEnStock > 0
                fournisseurId,
                page = 1,
                limit = 10
            } = req.query;

            if (!q && !type && prixMin === undefined && prixMax === undefined && enStock === undefined && !fournisseurId) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un critère de recherche est requis (q, type, prixMin, prixMax, enStock ou fournisseurId).'
                });
            }

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            const filters = [];

            if (q) {
                filters.push({
                    OR: [
                        { reference: { contains: q, mode: 'insensitive' } },
                        { marque: { contains: q, mode: 'insensitive' } }
                    ]
                });
            }

            if (type && Object.values(TypeProduit).includes(type)) {
                filters.push({ type });
            }

            if (prixMin !== undefined || prixMax !== undefined) {
                const rangePrix = {};
                if (prixMin !== undefined) rangePrix.gte = Number(prixMin);
                if (prixMax !== undefined) rangePrix.lte = Number(prixMax);
                filters.push({ prixVente: rangePrix });
            }

            if (enStock === 'true') {
                filters.push({ quantiteEnStock: { gt: 0 } });
            }

            if (fournisseurId) {
                filters.push({ fournisseurId });
            }

            const whereClause = {
                ...tenantFilter,
                ...(filters.length > 0 ? { AND: filters } : {})
            };

            const [produits, total] = await Promise.all([
                prisma.produit.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        produitId: true,
                        reference: true,
                        type: true,
                        marque: true,
                        prixAchat: true,
                        prixVente: true,
                        quantiteEnStock: true,
                        fournisseur: {
                            select: { nom: true }
                        },
                        _count: {
                            select: { lignesVente: true }
                        }
                    },
                    orderBy: { reference: 'asc' }
                }),
                prisma.produit.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: produits,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la recherche de produits :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET STOCK GLOBAL — Vue d'ensemble du stock de la boutique
    // Accès : ADMIN, VENDEUR
    // GET /api/produits/stock/global
    // ============================================================
    static async getStockGlobal(req, res) {
        try {
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            const [
                totalProduits,
                stockParType,
                valeursStock,
                produitsEnRupture,
                top5PlusBas
            ] = await Promise.all([
                prisma.produit.count({ where: tenantFilter }),

                // Stock regroupé par type
                prisma.produit.groupBy({
                    by: ['type'],
                    where: tenantFilter,
                    _sum: { quantiteEnStock: true },
                    _count: { _all: true }
                }),

                // Valeur totale du stock (achat + vente)
                prisma.produit.findMany({
                    where: tenantFilter,
                    select: { prixAchat: true, prixVente: true, quantiteEnStock: true }
                }),

                // Produits en rupture
                prisma.produit.count({
                    where: { ...tenantFilter, quantiteEnStock: 0 }
                }),

                // 5 produits avec le stock le plus bas (hors zéro)
                prisma.produit.findMany({
                    where: { ...tenantFilter, quantiteEnStock: { gt: 0 } },
                    orderBy: { quantiteEnStock: 'asc' },
                    take: 5,
                    select: {
                        produitId: true,
                        reference: true,
                        type: true,
                        marque: true,
                        quantiteEnStock: true,
                        prixVente: true
                    }
                })
            ]);

            // -- Calcul des valeurs totales --
            const valeurTotaleAchat = valeursStock.reduce(
                (sum, p) => sum + (p.prixAchat * p.quantiteEnStock), 0
            );
            const valeurTotaleVente = valeursStock.reduce(
                (sum, p) => sum + (p.prixVente * p.quantiteEnStock), 0
            );

            // -- Formatage du stock par type --
            const stockParTypeMap = stockParType.reduce((acc, item) => {
                acc[item.type] = {
                    quantite: item._sum.quantiteEnStock || 0,
                    nombreProduits: item._count._all
                };
                return acc;
            }, {});

            return res.status(200).json({
                success: true,
                data: {
                    resume: {
                        totalProduits,
                        produitsEnRupture,
                        produitsDisponibles: totalProduits - produitsEnRupture,
                        valeurTotaleAchat,
                        valeurTotaleVente,
                        margeTheorique: valeurTotaleVente - valeurTotaleAchat
                    },
                    parType: stockParTypeMap,
                    alertesStockBas: top5PlusBas
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du stock global :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du stock global.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default ProduitController;
