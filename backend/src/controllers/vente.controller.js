import pkg from '@prisma/client';
const { Role, StatutPaiement, MethodePaiement } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * VenteController
 * Gère le cycle de vie complet d'une vente avec isolation multi-tenant.
 *
 * Une vente est la transaction commerciale centrale du système :
 *   - Elle regroupe des lignes produits (LigneVente) avec prix figés
 *   - Elle peut être liée à un patient, une ordonnance et/ou un devis converti
 *   - Les paiements sont enregistrés séparément et mis à jour dans resteAPayer
 *   - Chaque vente déclenche une sortie de stock (MouvementStock)
 *   - Le statut (PAYE / PARTIEL / IMPAYE) est recalculé après chaque paiement
 *
 * Règles comptables :
 *   montantNet  = montantTotal - remise
 *   resteAPayer = montantNet - Σ(paiements)
 *   statut      = PAYE si resteAPayer = 0
 *               = PARTIEL si 0 < resteAPayer < montantNet
 *               = IMPAYE si aucun paiement
 */
class VenteController {

    // ============================================================
    // CREATE — Créer une nouvelle vente
    // Accès : ADMIN, VENDEUR
    // POST /api/ventes
    //
    // Corps attendu :
    //   lignes[]       : [{ produitId, quantite, prixUnitaire? }]
    //   remise?        : montant remisé (défaut 0)
    //   patientId?     : UUID patient (optionnel)
    //   ordonnanceId?  : UUID ordonnance (optionnel)
    //   devisId?       : UUID devis à convertir (optionnel)
    //   paiementInitial? : { montant, methode } premier paiement immédiat
    // ============================================================
    static async create(req, res) {
        try {
            const {
                lignes,
                remise = 0,
                patientId,
                ordonnanceId,
                devisId,
                paiementInitial
            } = req.body;

            // -- Validation des lignes --
            if (!lignes || !Array.isArray(lignes) || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La vente doit contenir au moins une ligne produit.'
                });
            }

            if (Number(remise) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La remise ne peut pas être négative.'
                });
            }

            // -- Validation de chaque ligne --
            for (const [index, ligne] of lignes.entries()) {
                if (!ligne.produitId) {
                    return res.status(400).json({
                        success: false,
                        message: `Ligne ${index + 1} : le produitId est obligatoire.`
                    });
                }
                if (!ligne.quantite || Number(ligne.quantite) <= 0 || !Number.isInteger(Number(ligne.quantite))) {
                    return res.status(400).json({
                        success: false,
                        message: `Ligne ${index + 1} : la quantite doit être un entier strictement positif.`
                    });
                }
                if (ligne.prixUnitaire !== undefined && Number(ligne.prixUnitaire) < 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Ligne ${index + 1} : le prixUnitaire ne peut pas être négatif.`
                    });
                }
            }

            // -- Vérification du paiement initial si fourni --
            if (paiementInitial) {
                const methodesValides = Object.values(MethodePaiement);
                if (!paiementInitial.montant || Number(paiementInitial.montant) <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le montant du paiement initial doit être strictement positif.'
                    });
                }
                if (!paiementInitial.methode || !methodesValides.includes(paiementInitial.methode)) {
                    return res.status(400).json({
                        success: false,
                        message: `Méthode de paiement invalide. Méthodes autorisées : ${methodesValides.join(', ')}.`
                    });
                }
            }

            // -- Vérification patient (isolation tenant) --
            if (patientId) {
                const patientExiste = await prisma.patient.findFirst({
                    where: { patientId, tenantId: req.user.tenantId }
                });
                if (!patientExiste) {
                    return res.status(404).json({
                        success: false,
                        message: 'Patient non trouvé dans cette boutique.'
                    });
                }
            }

            // -- Vérification ordonnance (isolation tenant) --
            if (ordonnanceId) {
                const ordonnanceExiste = await prisma.ordonnance.findFirst({
                    where: { ordonnanceId, tenantId: req.user.tenantId }
                });
                if (!ordonnanceExiste) {
                    return res.status(404).json({
                        success: false,
                        message: 'Ordonnance non trouvée dans cette boutique.'
                    });
                }
            }

            // -- Vérification et validation du devis à convertir --
            if (devisId) {
                const devis = await prisma.devis.findFirst({
                    where: { devisId, tenantId: req.user.tenantId }
                });
                if (!devis) {
                    return res.status(404).json({
                        success: false,
                        message: 'Devis non trouvé dans cette boutique.'
                    });
                }
                if (devis.statut !== 'ACCEPTE') {
                    return res.status(409).json({
                        success: false,
                        message: `Le devis ne peut être converti que s'il est au statut ACCEPTE. Statut actuel : ${devis.statut}.`
                    });
                }
                // Vérification que le devis n'a pas déjà généré une vente
                const venteExistante = await prisma.vente.findUnique({ where: { devisId } });
                if (venteExistante) {
                    return res.status(409).json({
                        success: false,
                        message: 'Ce devis a déjà été converti en vente.'
                    });
                }
            }

            // -- Résolution des produits et prix pour chaque ligne --
            const lignesResolues = [];
            for (const [index, ligne] of lignes.entries()) {
                const produit = await prisma.produit.findFirst({
                    where: { produitId: ligne.produitId, tenantId: req.user.tenantId }
                });

                if (!produit) {
                    return res.status(404).json({
                        success: false,
                        message: `Ligne ${index + 1} : produit "${ligne.produitId}" non trouvé dans cette boutique.`
                    });
                }

                const quantite = Number(ligne.quantite);

                // Vérification du stock disponible
                if (produit.quantiteEnStock < quantite) {
                    return res.status(400).json({
                        success: false,
                        message: `Ligne ${index + 1} : stock insuffisant pour "${produit.reference}". Stock actuel : ${produit.quantiteEnStock}, quantité demandée : ${quantite}.`,
                        produit: { reference: produit.reference, stockActuel: produit.quantiteEnStock }
                    });
                }

                // Le prixUnitaire fourni prévaut sur le prix catalogue
                const prixUnitaire = ligne.prixUnitaire !== undefined
                    ? Number(ligne.prixUnitaire)
                    : produit.prixVente;

                lignesResolues.push({ produit, quantite, prixUnitaire });
            }

            // -- Calculs financiers --
            const montantBrut = lignesResolues.reduce((sum, l) => sum + (l.quantite * l.prixUnitaire), 0);
            const remiseNum = Number(remise);
            const montantTotal = montantBrut;        // montantTotal stocke le brut
            const montantNet = montantBrut - remiseNum;

            if (remiseNum > montantBrut) {
                return res.status(400).json({
                    success: false,
                    message: `La remise (${remiseNum}) ne peut pas dépasser le montant total (${montantBrut}).`
                });
            }

            // -- Calcul du reste à payer après paiement initial éventuel --
            const montantPaiementInitial = paiementInitial ? Number(paiementInitial.montant) : 0;

            if (montantPaiementInitial > montantNet) {
                return res.status(400).json({
                    success: false,
                    message: `Le paiement initial (${montantPaiementInitial}) dépasse le montant net (${montantNet}).`
                });
            }

            const resteAPayer = montantNet - montantPaiementInitial;

            // -- Détermination du statut initial --
            let statut;
            if (resteAPayer === 0) {
                statut = StatutPaiement.PAYE;
            } else if (montantPaiementInitial > 0) {
                statut = StatutPaiement.PARTIEL;
            } else {
                statut = StatutPaiement.IMPAYE;
            }

            // -- Transaction atomique : vente + lignes + mouvements stock + paiement --
            const vente = await prisma.$transaction(async (tx) => {

                // 1. Création de la vente
                const nouvelleVente = await tx.vente.create({
                    data: {
                        tenantId: req.user.tenantId,
                        userId: req.user.userId,
                        patientId: patientId || null,
                        ordonnanceId: ordonnanceId || null,
                        devisId: devisId || null,
                        montantTotal,
                        remise: remiseNum,
                        resteAPayer,
                        statut
                    }
                });

                // 2. Création des lignes de vente
                await tx.ligneVente.createMany({
                    data: lignesResolues.map(({ produit, quantite, prixUnitaire }) => ({
                        venteId: nouvelleVente.venteId,
                        produitId: produit.produitId,
                        quantite,
                        prixUnitaire
                    }))
                });

                // 3. Mise à jour du stock + MouvementStock pour chaque produit
                for (const { produit, quantite } of lignesResolues) {
                    const quantiteAvant = produit.quantiteEnStock;
                    const quantiteApres = quantiteAvant - quantite;

                    await tx.produit.update({
                        where: { produitId: produit.produitId },
                        data: { quantiteEnStock: quantiteApres }
                    });

                    await tx.mouvementStock.create({
                        data: {
                            tenantId: req.user.tenantId,
                            produitId: produit.produitId,
                            userId: req.user.userId,
                            venteId: nouvelleVente.venteId,
                            type: 'SORTIE',
                            quantite,
                            quantiteAvant,
                            quantiteApres,
                            motif: `Vente #${nouvelleVente.venteId}`
                        }
                    });
                }

                // 4. Enregistrement du paiement initial si fourni
                if (paiementInitial) {
                    await tx.paiement.create({
                        data: {
                            venteId: nouvelleVente.venteId,
                            userId: req.user.userId,
                            montant: montantPaiementInitial,
                            methode: paiementInitial.methode
                        }
                    });
                }

                // 5. Si conversion d'un devis, mettre à jour son statut
                if (devisId) {
                    await tx.devis.update({
                        where: { devisId },
                        data: { statut: 'ACCEPTE' }
                    });
                }

                return nouvelleVente;
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: req.user.tenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'Vente',
                    entiteId: vente.venteId,
                    nouvellesValeurs: {
                        montantTotal,
                        remise: remiseNum,
                        resteAPayer,
                        statut,
                        nbLignes: lignesResolues.length,
                        patientId: patientId || null,
                        ordonnanceId: ordonnanceId || null,
                        devisId: devisId || null
                    }
                }
            });

            // -- Rechargement avec toutes les relations pour la réponse --
            const venteComplete = await prisma.vente.findUnique({
                where: { venteId: vente.venteId },
                include: {
                    lignes: {
                        include: {
                            produit: {
                                select: { produitId: true, reference: true, type: true, marque: true }
                            }
                        }
                    },
                    paiements: {
                        select: { paiementId: true, montant: true, methode: true, datePaiement: true }
                    },
                    patient: { select: { patientId: true, nomComplet: true } },
                    ordonnance: { select: { ordonnanceId: true, datePrescription: true, nomMedecin: true } },
                    devis: { select: { devisId: true, statut: true } },
                    utilisateur: { select: { userId: true, nom: true, role: true } }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Vente créée avec succès.',
                data: venteComplete
            });

        } catch (error) {
            console.error('Erreur lors de la création de la vente :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la vente.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET ALL — Lister les ventes
    // Accès : Tous les rôles (filtrés par tenant sauf SUPER_ADMIN)
    // GET /api/ventes
    // Query : page, limit, statut, patientId, userId,
    //         dateDebut, dateFin, sortBy, order
    // ============================================================
    static async getAll(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                statut,
                patientId,
                userId,
                dateDebut,
                dateFin,
                sortBy = 'dateCreation',
                order = 'desc'
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Filtre statut --
            const statutsValides = Object.values(StatutPaiement);
            const statutFilter = statut && statutsValides.includes(statut) ? { statut } : {};

            // -- Filtre patient --
            const patientFilter = patientId ? { patientId } : {};

            // -- Filtre vendeur --
            const vendeurFilter = userId ? { userId } : {};

            // -- Filtre plage de dates --
            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const dateCreationFilter = Object.keys(dateFilter).length > 0
                ? { dateCreation: dateFilter }
                : {};

            // -- Tri sécurisé --
            const champsAutorises = ['dateCreation', 'montantTotal', 'resteAPayer', 'statut'];
            const sortField = champsAutorises.includes(sortBy) ? sortBy : 'dateCreation';
            const sortOrder = order === 'asc' ? 'asc' : 'desc';

            const whereClause = {
                ...tenantFilter,
                ...statutFilter,
                ...patientFilter,
                ...vendeurFilter,
                ...dateCreationFilter
            };

            const [ventes, total] = await Promise.all([
                prisma.vente.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        venteId: true,
                        dateCreation: true,
                        montantTotal: true,
                        remise: true,
                        resteAPayer: true,
                        statut: true,
                        tenantId: true,
                        patient: {
                            select: { patientId: true, nomComplet: true, telephone: true }
                        },
                        utilisateur: {
                            select: { userId: true, nom: true, role: true }
                        },
                        _count: {
                            select: {
                                lignes: true,
                                paiements: true,
                                retours: true
                            }
                        }
                    },
                    orderBy: { [sortField]: sortOrder }
                }),
                prisma.vente.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: ventes,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des ventes :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des ventes.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET BY ID — Détails complets d'une vente
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/ventes/:venteId
    // ============================================================
    static async getById(req, res) {
        try {
            const { venteId } = req.params;

            const vente = await prisma.vente.findFirst({
                where: {
                    venteId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    lignes: {
                        include: {
                            produit: {
                                select: {
                                    produitId: true,
                                    reference: true,
                                    type: true,
                                    marque: true,
                                    prixVente: true  // prix catalogue actuel pour comparaison
                                }
                            }
                        }
                    },
                    paiements: {
                        select: {
                            paiementId: true,
                            montant: true,
                            methode: true,
                            datePaiement: true,
                            utilisateur: { select: { userId: true, nom: true } }
                        },
                        orderBy: { datePaiement: 'asc' }
                    },
                    patient: {
                        select: {
                            patientId: true,
                            nomComplet: true,
                            telephone: true,
                            nomAssurance: true
                        }
                    },
                    ordonnance: {
                        select: {
                            ordonnanceId: true,
                            datePrescription: true,
                            nomMedecin: true,
                            sphereOD: true,
                            cylindreOD: true,
                            axeOD: true,
                            sphereOG: true,
                            cylindreOG: true,
                            axeOG: true
                        }
                    },
                    devis: {
                        select: { devisId: true, statut: true, dateCreation: true }
                    },
                    utilisateur: {
                        select: { userId: true, nom: true, role: true }
                    },
                    commandeAtelier: {
                        select: {
                            commandeId: true,
                            statut: true,
                            typeVerre: true,
                            traitements: true,
                            dateExecutionJour: true
                        }
                    },
                    retours: {
                        select: {
                            retourId: true,
                            dateRetour: true,
                            statut: true,
                            montantRembourse: true,
                            motif: true
                        }
                    }
                }
            });

            if (!vente) {
                return res.status(404).json({
                    success: false,
                    message: 'Vente non trouvée.'
                });
            }

            // -- Calcul du montant net pour la réponse --
            const montantNet = vente.montantTotal - vente.remise;
            const totalEncaisse = vente.paiements.reduce((sum, p) => sum + p.montant, 0);

            return res.status(200).json({
                success: true,
                data: {
                    ...vente,
                    montantNet,
                    totalEncaisse
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération de la vente :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la vente.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // ADD PAIEMENT — Enregistrer un paiement sur une vente
    // Accès : ADMIN, VENDEUR
    // POST /api/ventes/:venteId/paiements
    //
    // Met à jour resteAPayer et recalcule le statut automatiquement.
    // Plusieurs paiements partiels sont possibles sur la même vente.
    // ============================================================
    static async addPaiement(req, res) {
        try {
            const { venteId } = req.params;
            const { montant, methode } = req.body;

            // -- Validation des champs obligatoires --
            if (!montant || Number(montant) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le montant du paiement doit être strictement positif.'
                });
            }

            const methodesValides = Object.values(MethodePaiement);
            if (!methode || !methodesValides.includes(methode)) {
                return res.status(400).json({
                    success: false,
                    message: `Méthode de paiement invalide. Méthodes autorisées : ${methodesValides.join(', ')}.`
                });
            }

            // -- Vérification existence + isolation tenant --
            const vente = await prisma.vente.findFirst({
                where: {
                    venteId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!vente) {
                return res.status(404).json({
                    success: false,
                    message: 'Vente non trouvée.'
                });
            }

            // -- Vente déjà entièrement payée --
            if (vente.statut === StatutPaiement.PAYE) {
                return res.status(409).json({
                    success: false,
                    message: 'Cette vente est déjà entièrement payée.'
                });
            }

            const montantNum = Number(montant);

            // -- Paiement ne peut pas dépasser le reste à payer --
            if (montantNum > vente.resteAPayer) {
                return res.status(400).json({
                    success: false,
                    message: `Le montant (${montantNum}) dépasse le reste à payer (${vente.resteAPayer}).`,
                    resteAPayer: vente.resteAPayer
                });
            }

            // -- Calcul du nouveau reste et du nouveau statut --
            const nouveauResteAPayer = vente.resteAPayer - montantNum;

            const nouveauStatut = nouveauResteAPayer === 0
                ? StatutPaiement.PAYE
                : StatutPaiement.PARTIEL;

            // -- Transaction : paiement + mise à jour vente --
            const [paiement, venteMAJ] = await prisma.$transaction([
                prisma.paiement.create({
                    data: {
                        venteId,
                        userId: req.user.userId,
                        montant: montantNum,
                        methode
                    }
                }),
                prisma.vente.update({
                    where: { venteId },
                    data: {
                        resteAPayer: nouveauResteAPayer,
                        statut: nouveauStatut
                    },
                    select: {
                        venteId: true,
                        montantTotal: true,
                        remise: true,
                        resteAPayer: true,
                        statut: true
                    }
                })
            ]);

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: vente.tenantId,
                    userId: req.user.userId,
                    action: 'MODIFICATION',
                    modele: 'Vente',
                    entiteId: venteId,
                    anciennesValeurs: {
                        resteAPayer: vente.resteAPayer,
                        statut: vente.statut
                    },
                    nouvellesValeurs: {
                        paiementAjoute: montantNum,
                        methode,
                        resteAPayer: nouveauResteAPayer,
                        statut: nouveauStatut
                    }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Paiement enregistré avec succès.',
                data: {
                    paiement: {
                        paiementId: paiement.paiementId,
                        montant: paiement.montant,
                        methode: paiement.methode,
                        datePaiement: paiement.datePaiement
                    },
                    vente: venteMAJ
                }
            });

        } catch (error) {
            console.error('Erreur lors de l\'enregistrement du paiement :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'enregistrement du paiement.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET PAIEMENTS — Liste des paiements d'une vente
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/ventes/:venteId/paiements
    // ============================================================
    static async getPaiements(req, res) {
        try {
            const { venteId } = req.params;

            const vente = await prisma.vente.findFirst({
                where: {
                    venteId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                select: {
                    venteId: true,
                    montantTotal: true,
                    remise: true,
                    resteAPayer: true,
                    statut: true
                }
            });

            if (!vente) {
                return res.status(404).json({
                    success: false,
                    message: 'Vente non trouvée.'
                });
            }

            const paiements = await prisma.paiement.findMany({
                where: { venteId },
                select: {
                    paiementId: true,
                    montant: true,
                    methode: true,
                    datePaiement: true,
                    utilisateur: { select: { userId: true, nom: true, role: true } }
                },
                orderBy: { datePaiement: 'asc' }
            });

            const totalEncaisse = paiements.reduce((sum, p) => sum + p.montant, 0);
            const montantNet = vente.montantTotal - vente.remise;

            return res.status(200).json({
                success: true,
                data: {
                    vente: {
                        ...vente,
                        montantNet,
                        totalEncaisse
                    },
                    paiements
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des paiements :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des paiements.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // ANNULER — Annuler une vente (remise en stock + statut)
    // Accès : ADMIN, SUPER_ADMIN
    // PATCH /api/ventes/:venteId/annuler
    //
    // ⚠️  Une vente ayant des paiements enregistrés ne peut PAS
    //     être annulée directement : créer un Retour à la place.
    //     Une vente déjà annulée ne peut pas l'être une seconde fois.
    // ============================================================
    static async annuler(req, res) {
        try {
            const { venteId } = req.params;
            const { motif } = req.body;

            // -- Vérification existence + isolation tenant --
            const vente = await prisma.vente.findFirst({
                where: {
                    venteId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    lignes: { include: { produit: true } },
                    paiements: true,
                    retours: true
                }
            });

            if (!vente) {
                return res.status(404).json({
                    success: false,
                    message: 'Vente non trouvée.'
                });
            }

            // -- Blocage si des paiements ont déjà été encaissés --
            if (vente.paiements.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Impossible d\'annuler une vente avec des paiements enregistrés. Créez un retour à la place.',
                    details: { nombrePaiements: vente.paiements.length }
                });
            }

            // -- Blocage si des retours existent --
            if (vente.retours.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Impossible d\'annuler une vente ayant des retours associés.',
                    details: { nombreRetours: vente.retours.length }
                });
            }

            // -- Transaction : remise en stock + mise à jour statut --
            await prisma.$transaction(async (tx) => {
                // Remise en stock de chaque produit
                for (const ligne of vente.lignes) {
                    const quantiteAvant = ligne.produit.quantiteEnStock;
                    const quantiteApres = quantiteAvant + ligne.quantite;

                    await tx.produit.update({
                        where: { produitId: ligne.produitId },
                        data: { quantiteEnStock: quantiteApres }
                    });

                    await tx.mouvementStock.create({
                        data: {
                            tenantId: vente.tenantId,
                            produitId: ligne.produitId,
                            userId: req.user.userId,
                            venteId: vente.venteId,
                            type: 'ENTREE',
                            quantite: ligne.quantite,
                            quantiteAvant,
                            quantiteApres,
                            motif: `Annulation vente #${venteId}${motif ? ' — ' + motif : ''}`
                        }
                    });
                }

                // Marquer la vente comme annulée via resteAPayer négatif sentinel
                // et statut IMPAYE (pas d'enum ANNULE dans le schéma)
                await tx.vente.update({
                    where: { venteId },
                    data: {
                        statut: StatutPaiement.IMPAYE,
                        resteAPayer: -1   // valeur sentinelle : -1 indique une annulation
                    }
                });
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: vente.tenantId,
                    userId: req.user.userId,
                    action: 'CHANGEMENT_STATUT',
                    modele: 'Vente',
                    entiteId: venteId,
                    anciennesValeurs: { statut: vente.statut, resteAPayer: vente.resteAPayer },
                    nouvellesValeurs: { statut: 'ANNULEE', resteAPayer: -1, motif: motif || null }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Vente annulée avec succès. Le stock a été remis à jour.'
            });

        } catch (error) {
            console.error('Erreur lors de l\'annulation de la vente :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'annulation de la vente.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET STATS — Statistiques de ventes de la boutique
    // Accès : ADMIN, VENDEUR
    // GET /api/ventes/stats/global
    // Query : dateDebut, dateFin
    // ============================================================
    static async getStatsGlobal(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;

            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Construction du filtre de dates --
            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const dateCreationFilter = Object.keys(dateFilter).length > 0
                ? { dateCreation: dateFilter }
                : {};

            const whereClause = { ...tenantFilter, ...dateCreationFilter };

            const [
                totalVentes,
                ventesParStatut,
                aggregats,
                ventesParJour,
                top5Produits,
                top5Vendeurs
            ] = await Promise.all([

                // Total des ventes
                prisma.vente.count({ where: whereClause }),

                // Répartition par statut
                prisma.vente.groupBy({
                    by: ['statut'],
                    where: whereClause,
                    _count: { _all: true },
                    _sum: { montantTotal: true }
                }),

                // Agrégats financiers
                prisma.vente.aggregate({
                    where: whereClause,
                    _sum: {
                        montantTotal: true,
                        remise: true,
                        resteAPayer: true
                    },
                    _avg: { montantTotal: true }
                }),

                // Ventes par jour (7 derniers jours si pas de filtre date)
                prisma.vente.groupBy({
                    by: ['dateCreation'],
                    where: {
                        ...tenantFilter,
                        dateCreation: Object.keys(dateFilter).length > 0
                            ? dateFilter
                            : { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                    },
                    _count: { _all: true },
                    _sum: { montantTotal: true },
                    orderBy: { dateCreation: 'asc' }
                }),

                // Top 5 produits les plus vendus
                prisma.ligneVente.groupBy({
                    by: ['produitId'],
                    where: { vente: whereClause },
                    _sum: { quantite: true },
                    orderBy: { _sum: { quantite: 'desc' } },
                    take: 5
                }),

                // Top 5 vendeurs par CA
                prisma.vente.groupBy({
                    by: ['userId'],
                    where: whereClause,
                    _count: { _all: true },
                    _sum: { montantTotal: true },
                    orderBy: { _sum: { montantTotal: 'desc' } },
                    take: 5
                })
            ]);

            // -- Enrichissement des top produits avec les infos catalogue --
            const top5ProduitsEnrichis = await Promise.all(
                top5Produits.map(async (item) => {
                    const produit = await prisma.produit.findUnique({
                        where: { produitId: item.produitId },
                        select: { produitId: true, reference: true, type: true, marque: true, prixVente: true }
                    });
                    return { ...produit, quantiteTotaleVendue: item._sum.quantite };
                })
            );

            // -- Enrichissement des top vendeurs avec les infos utilisateur --
            const top5VendeursEnrichis = await Promise.all(
                top5Vendeurs.map(async (item) => {
                    const utilisateur = await prisma.utilisateur.findUnique({
                        where: { userId: item.userId },
                        select: { userId: true, nom: true, role: true }
                    });
                    return {
                        ...utilisateur,
                        nombreVentes: item._count._all,
                        chiffreAffaires: item._sum.montantTotal
                    };
                })
            );

            // -- Formatage ventesParStatut --
            const statutsMap = ventesParStatut.reduce((acc, item) => {
                acc[item.statut] = {
                    count: item._count._all,
                    montantTotal: item._sum.montantTotal || 0
                };
                return acc;
            }, {});

            return res.status(200).json({
                success: true,
                data: {
                    periode: {
                        dateDebut: dateDebut || null,
                        dateFin: dateFin || null
                    },
                    resume: {
                        totalVentes,
                        montantTotalBrut: aggregats._sum.montantTotal || 0,
                        remiseTotale: aggregats._sum.remise || 0,
                        montantNetTotal: (aggregats._sum.montantTotal || 0) - (aggregats._sum.remise || 0),
                        resteAPayerTotal: aggregats._sum.resteAPayer || 0,
                        montantMoyenVente: aggregats._avg.montantTotal
                            ? Number(aggregats._avg.montantTotal.toFixed(2))
                            : 0
                    },
                    parStatut: statutsMap,
                    evolutionJours: ventesParJour.map(v => ({
                        date: v.dateCreation,
                        nombreVentes: v._count._all,
                        montantTotal: v._sum.montantTotal || 0
                    })),
                    top5Produits: top5ProduitsEnrichis,
                    top5Vendeurs: top5VendeursEnrichis
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques des ventes.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // SEARCH — Recherche avancée de ventes
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/ventes/search
    // ============================================================
    static async search(req, res) {
        try {
            const {
                patientNom,   // recherche sur le nom du patient
                statut,
                montantMin,
                montantMax,
                dateDebut,
                dateFin,
                page = 1,
                limit = 10
            } = req.query;

            if (!patientNom && !statut && !montantMin && !montantMax && !dateDebut && !dateFin) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un critère de recherche est requis.'
                });
            }

            const skip = (Number(page) - 1) * Number(limit);

            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            const filters = [];

            if (patientNom) {
                filters.push({
                    patient: { nomComplet: { contains: patientNom, mode: 'insensitive' } }
                });
            }

            if (statut && Object.values(StatutPaiement).includes(statut)) {
                filters.push({ statut });
            }

            if (montantMin !== undefined || montantMax !== undefined) {
                const rangeMontant = {};
                if (montantMin !== undefined) rangeMontant.gte = Number(montantMin);
                if (montantMax !== undefined) rangeMontant.lte = Number(montantMax);
                filters.push({ montantTotal: rangeMontant });
            }

            if (dateDebut || dateFin) {
                const rangeDate = {};
                if (dateDebut) rangeDate.gte = new Date(dateDebut);
                if (dateFin) rangeDate.lte = new Date(dateFin);
                filters.push({ dateCreation: rangeDate });
            }

            const whereClause = {
                ...tenantFilter,
                ...(filters.length > 0 ? { AND: filters } : {})
            };

            const [ventes, total] = await Promise.all([
                prisma.vente.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        venteId: true,
                        dateCreation: true,
                        montantTotal: true,
                        remise: true,
                        resteAPayer: true,
                        statut: true,
                        patient: {
                            select: { patientId: true, nomComplet: true, telephone: true }
                        },
                        utilisateur: {
                            select: { userId: true, nom: true }
                        },
                        _count: {
                            select: { lignes: true, paiements: true }
                        }
                    },
                    orderBy: { dateCreation: 'desc' }
                }),
                prisma.vente.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: ventes,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la recherche de ventes :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default VenteController;
