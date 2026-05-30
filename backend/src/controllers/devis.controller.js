import pkg from '@prisma/client';
const { Role, StatutDevis } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * DevisController
 * Gère le cycle de vie complet d'un devis avec isolation multi-tenant.
 *
 * Un devis est une proposition commerciale adressée à un patient avant validation :
 *   - Il regroupe des lignes produits (LigneDevis) avec prix figés à la création
 *   - Il suit un cycle de vie strict : BROUILLON → ENVOYE → ACCEPTE/REFUSE/EXPIRE
 *   - Un devis ACCEPTE peut être converti en Vente (relation 1:1 via devisId)
 *   - Un devis EXPIRE ou REFUSE ne peut plus changer de statut
 *   - La date d'expiration est vérifiée automatiquement à chaque lecture
 *
 * Cycle de vie :
 *   BROUILLON  → peut être modifié, envoyé ou supprimé
 *   ENVOYE     → peut passer à ACCEPTE, REFUSE ou EXPIRE
 *   ACCEPTE    → peut être converti en Vente (terminal sauf conversion)
 *   REFUSE     → statut terminal
 *   EXPIRE     → statut terminal (déclenché automatiquement si dateExpiration dépassée)
 *
 * Règle de calcul :
 *   montantNet = montantTotal - remise
 */

class DevisController {

    // ============================================================
    // CREATE — Créer un nouveau devis
    // Accès : ADMIN, VENDEUR
    // POST /api/devis
    //
    // Corps attendu :
    //   lignes[]        : [{ produitId, quantite, prixUnitaire? }]
    //   remise?         : montant remisé en FCFA (défaut 0)
    //   patientId?      : UUID patient (optionnel)
    //   dateExpiration? : date limite de validité ISO 8601 (optionnel)
    //   notes?          : observations libres (optionnel)
    // ============================================================
    static async create(req, res) {
        try {
            const {
                lignes,
                remise = 0,
                patientId,
                dateExpiration,
                notes
            } = req.body;

            // -- Validation des lignes --
            if (!lignes || !Array.isArray(lignes) || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le devis doit contenir au moins une ligne produit.'
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

            // -- Validation de la date d'expiration --
            let dateExpirationParsed = null;
            if (dateExpiration) {
                dateExpirationParsed = new Date(dateExpiration);
                if (isNaN(dateExpirationParsed.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le format de dateExpiration est invalide. Utilisez le format ISO 8601.'
                    });
                }
                if (dateExpirationParsed <= new Date()) {
                    return res.status(400).json({
                        success: false,
                        message: 'La dateExpiration doit être dans le futur.'
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

            // -- Résolution des produits et calcul du montant --
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

                // Le prixUnitaire fourni prévaut sur le prix catalogue
                const prixUnitaire = ligne.prixUnitaire !== undefined
                    ? Number(ligne.prixUnitaire)
                    : produit.prixVente;

                lignesResolues.push({
                    produitId: produit.produitId,
                    quantite: Number(ligne.quantite),
                    prixUnitaire
                });
            }

            // -- Calculs financiers --
            const montantTotal = lignesResolues.reduce(
                (sum, l) => sum + (l.quantite * l.prixUnitaire), 0
            );
            const remiseNum = Number(remise);

            if (remiseNum > montantTotal) {
                return res.status(400).json({
                    success: false,
                    message: `La remise (${remiseNum}) ne peut pas dépasser le montant total (${montantTotal}).`
                });
            }

            // -- Création du devis + lignes dans une transaction --
            const devis = await prisma.$transaction(async (tx) => {
                const nouveauDevis = await tx.devis.create({
                    data: {
                        tenantId: req.user.tenantId,
                        userId: req.user.userId,
                        patientId: patientId || null,
                        montantTotal,
                        remise: remiseNum,
                        notes: notes ? notes.trim() : null,
                        dateExpiration: dateExpirationParsed,
                        statut: StatutDevis.BROUILLON
                    }
                });

                await tx.ligneDevis.createMany({
                    data: lignesResolues.map((l) => ({
                        devisId: nouveauDevis.devisId,
                        produitId: l.produitId,
                        quantite: l.quantite,
                        prixUnitaire: l.prixUnitaire
                    }))
                });

                return nouveauDevis;
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: req.user.tenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'Devis',
                    entiteId: devis.devisId,
                    nouvellesValeurs: {
                        montantTotal,
                        remise: remiseNum,
                        statut: StatutDevis.BROUILLON,
                        nbLignes: lignesResolues.length,
                        patientId: patientId || null,
                        dateExpiration: dateExpirationParsed
                    }
                }
            });

            // -- Rechargement complet pour la réponse --
            const devisComplet = await prisma.devis.findUnique({
                where: { devisId: devis.devisId },
                include: {
                    lignes: {
                        include: {
                            produit: {
                                select: { produitId: true, reference: true, type: true, marque: true }
                            }
                        }
                    },
                    patient: { select: { patientId: true, nomComplet: true, telephone: true } },
                    utilisateur: { select: { userId: true, nom: true, role: true } },
                    vente: { select: { venteId: true, statut: true } }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Devis créé avec succès.',
                data: {
                    ...devisComplet,
                    montantNet: montantTotal - remiseNum
                }
            });

        } catch (error) {
            console.error('Erreur lors de la création du devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET ALL — Lister les devis
    // Accès : Tous les rôles (filtrés par tenant sauf SUPER_ADMIN)
    // GET /api/devis
    // Query : page, limit, statut, patientId, userId,
    //         dateDebut, dateFin, expire, sortBy, order
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
                expire,        // 'true' → uniquement les devis expirés non encore marqués
                sortBy = 'dateCreation',
                order = 'desc'
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Filtre statut --
            const statutsValides = Object.values(StatutDevis);
            const statutFilter = statut && statutsValides.includes(statut) ? { statut } : {};

            // -- Filtre patient --
            const patientFilter = patientId ? { patientId } : {};

            // -- Filtre créateur --
            const createurFilter = userId ? { userId } : {};

            // -- Filtre plage de dates de création --
            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const dateCreationFilter = Object.keys(dateFilter).length > 0
                ? { dateCreation: dateFilter }
                : {};

            // -- Filtre devis expirés non encore mis à jour --
            const expireFilter = expire === 'true'
                ? {
                    dateExpiration: { lt: new Date() },
                    statut: { notIn: [StatutDevis.ACCEPTE, StatutDevis.REFUSE, StatutDevis.EXPIRE] }
                }
                : {};

            // -- Tri sécurisé --
            const champsAutorises = ['dateCreation', 'dateExpiration', 'montantTotal', 'statut'];
            const sortField = champsAutorises.includes(sortBy) ? sortBy : 'dateCreation';
            const sortOrder = order === 'asc' ? 'asc' : 'desc';

            const whereClause = {
                ...tenantFilter,
                ...statutFilter,
                ...patientFilter,
                ...createurFilter,
                ...dateCreationFilter,
                ...expireFilter
            };

            const [devis, total] = await Promise.all([
                prisma.devis.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        devisId: true,
                        dateCreation: true,
                        dateExpiration: true,
                        montantTotal: true,
                        remise: true,
                        statut: true,
                        notes: true,
                        tenantId: true,
                        patient: {
                            select: { patientId: true, nomComplet: true, telephone: true }
                        },
                        utilisateur: {
                            select: { userId: true, nom: true, role: true }
                        },
                        vente: {
                            select: { venteId: true }
                        },
                        _count: {
                            select: { lignes: true }
                        }
                    },
                    orderBy: { [sortField]: sortOrder }
                }),
                prisma.devis.count({ where: whereClause })
            ]);

            // -- Enrichissement : marquer les devis qui ont expiré --
            const maintenant = new Date();
            const devisEnrichis = devis.map((d) => ({
                ...d,
                montantNet: d.montantTotal - d.remise,
                estExpire: d.dateExpiration && d.dateExpiration < maintenant &&
                    ![StatutDevis.ACCEPTE, StatutDevis.REFUSE, StatutDevis.EXPIRE].includes(d.statut),
                convertiEnVente: !!d.vente
            }));

            return res.status(200).json({
                success: true,
                data: devisEnrichis,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET BY ID — Détails complets d'un devis
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/devis/:devisId
    // ============================================================
    static async getById(req, res) {
        try {
            const { devisId } = req.params;

            const devis = await prisma.devis.findFirst({
                where: {
                    devisId,
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
                                    prixVente: true,  // prix catalogue actuel pour comparaison
                                    quantiteEnStock: true
                                }
                            }
                        }
                    },
                    patient: {
                        select: {
                            patientId: true,
                            nomComplet: true,
                            telephone: true,
                            nomAssurance: true
                        }
                    },
                    utilisateur: {
                        select: { userId: true, nom: true, role: true }
                    },
                    vente: {
                        select: {
                            venteId: true,
                            statut: true,
                            dateCreation: true,
                            montantTotal: true
                        }
                    }
                }
            });

            if (!devis) {
                return res.status(404).json({
                    success: false,
                    message: 'Devis non trouvé.'
                });
            }

            // -- Vérification automatique d'expiration --
            const maintenant = new Date();
            const estExpire =
                devis.dateExpiration &&
                devis.dateExpiration < maintenant &&
                ![StatutDevis.ACCEPTE, StatutDevis.REFUSE, StatutDevis.EXPIRE].includes(devis.statut);

            // -- Mise à jour auto du statut en EXPIRE si nécessaire --
            if (estExpire) {
                await prisma.devis.update({
                    where: { devisId },
                    data: { statut: StatutDevis.EXPIRE }
                });
                devis.statut = StatutDevis.EXPIRE;

                await prisma.historiqueAction.create({
                    data: {
                        tenantId: devis.tenantId,
                        userId: req.user.userId,
                        action: 'CHANGEMENT_STATUT',
                        modele: 'Devis',
                        entiteId: devisId,
                        anciennesValeurs: { statut: devis.statut },
                        nouvellesValeurs: { statut: StatutDevis.EXPIRE, motif: 'Expiration automatique' }
                    }
                });
            }

            const montantNet = devis.montantTotal - devis.remise;

            return res.status(200).json({
                success: true,
                data: {
                    ...devis,
                    montantNet,
                    convertiEnVente: !!devis.vente
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // UPDATE — Modifier un devis (BROUILLON uniquement)
    // Accès : ADMIN, VENDEUR (même tenant)
    // PATCH /api/devis/:devisId
    //
    // ⚠️  Seuls les devis au statut BROUILLON sont modifiables.
    //     La modification des lignes remplace entièrement l'ancien jeu.
    // ============================================================
    static async update(req, res) {
        try {
            const { devisId } = req.params;
            const {
                lignes,
                remise,
                patientId,
                dateExpiration,
                notes
            } = req.body;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.devis.findFirst({
                where: {
                    devisId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Devis non trouvé.'
                });
            }

            // -- Seul un devis BROUILLON est modifiable --
            if (existing.statut !== StatutDevis.BROUILLON) {
                return res.status(409).json({
                    success: false,
                    message: `Seul un devis au statut BROUILLON peut être modifié. Statut actuel : ${existing.statut}.`
                });
            }

            // -- Validation remise si fournie --
            if (remise !== undefined && Number(remise) < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La remise ne peut pas être négative.'
                });
            }

            // -- Validation date d'expiration si fournie --
            let dateExpirationParsed = undefined;
            if (dateExpiration !== undefined) {
                if (dateExpiration === null) {
                    dateExpirationParsed = null;
                } else {
                    dateExpirationParsed = new Date(dateExpiration);
                    if (isNaN(dateExpirationParsed.getTime())) {
                        return res.status(400).json({
                            success: false,
                            message: 'Le format de dateExpiration est invalide. Utilisez le format ISO 8601.'
                        });
                    }
                    if (dateExpirationParsed <= new Date()) {
                        return res.status(400).json({
                            success: false,
                            message: 'La dateExpiration doit être dans le futur.'
                        });
                    }
                }
            }

            // -- Validation du patient si fourni --
            if (patientId !== undefined && patientId !== null) {
                const patientExiste = await prisma.patient.findFirst({
                    where: { patientId, tenantId: existing.tenantId }
                });
                if (!patientExiste) {
                    return res.status(404).json({
                        success: false,
                        message: 'Patient non trouvé dans cette boutique.'
                    });
                }
            }

            // -- Résolution et recalcul si lignes fournies --
            let lignesResolues = null;
            let nouveauMontantTotal = existing.montantTotal;

            if (lignes !== undefined) {
                if (!Array.isArray(lignes) || lignes.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le devis doit contenir au moins une ligne produit.'
                    });
                }

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
                }

                lignesResolues = [];
                for (const [index, ligne] of lignes.entries()) {
                    const produit = await prisma.produit.findFirst({
                        where: { produitId: ligne.produitId, tenantId: existing.tenantId }
                    });
                    if (!produit) {
                        return res.status(404).json({
                            success: false,
                            message: `Ligne ${index + 1} : produit "${ligne.produitId}" non trouvé dans cette boutique.`
                        });
                    }
                    const prixUnitaire = ligne.prixUnitaire !== undefined
                        ? Number(ligne.prixUnitaire)
                        : produit.prixVente;

                    lignesResolues.push({
                        produitId: produit.produitId,
                        quantite: Number(ligne.quantite),
                        prixUnitaire
                    });
                }

                nouveauMontantTotal = lignesResolues.reduce(
                    (sum, l) => sum + (l.quantite * l.prixUnitaire), 0
                );
            }

            // -- Validation finale remise vs montant --
            const nouvelleRemise = remise !== undefined ? Number(remise) : existing.remise;
            if (nouvelleRemise > nouveauMontantTotal) {
                return res.status(400).json({
                    success: false,
                    message: `La remise (${nouvelleRemise}) ne peut pas dépasser le montant total (${nouveauMontantTotal}).`
                });
            }

            // -- Construction de l'objet de mise à jour --
            const updateData = {};
            if (remise !== undefined) updateData.remise = Number(remise);
            if (patientId !== undefined) updateData.patientId = patientId || null;
            if (dateExpirationParsed !== undefined) updateData.dateExpiration = dateExpirationParsed;
            if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;
            if (lignesResolues !== null) updateData.montantTotal = nouveauMontantTotal;

            if (Object.keys(updateData).length === 0 && lignesResolues === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune donnée à mettre à jour.'
                });
            }

            // -- Transaction : mise à jour devis + remplacement des lignes --
            const updated = await prisma.$transaction(async (tx) => {
                const devisMisAJour = await tx.devis.update({
                    where: { devisId },
                    data: updateData
                });

                // Remplacement complet des lignes si fournies
                if (lignesResolues !== null) {
                    await tx.ligneDevis.deleteMany({ where: { devisId } });
                    await tx.ligneDevis.createMany({
                        data: lignesResolues.map((l) => ({
                            devisId,
                            produitId: l.produitId,
                            quantite: l.quantite,
                            prixUnitaire: l.prixUnitaire
                        }))
                    });
                }

                return devisMisAJour;
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'MODIFICATION',
                    modele: 'Devis',
                    entiteId: devisId,
                    anciennesValeurs: {
                        montantTotal: existing.montantTotal,
                        remise: existing.remise,
                        patientId: existing.patientId,
                        dateExpiration: existing.dateExpiration,
                        notes: existing.notes
                    },
                    nouvellesValeurs: updateData
                }
            });

            // -- Rechargement complet pour la réponse --
            const devisComplet = await prisma.devis.findUnique({
                where: { devisId },
                include: {
                    lignes: {
                        include: {
                            produit: {
                                select: { produitId: true, reference: true, type: true, marque: true }
                            }
                        }
                    },
                    patient: { select: { patientId: true, nomComplet: true } },
                    utilisateur: { select: { userId: true, nom: true, role: true } },
                    vente: { select: { venteId: true } }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Devis mis à jour avec succès.',
                data: {
                    ...devisComplet,
                    montantNet: devisComplet.montantTotal - devisComplet.remise
                }
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour du devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // CHANGER STATUT — Changer le statut d'un devis
    // Accès : ADMIN, VENDEUR
    // PATCH /api/devis/:devisId/statut
    //
    // Transitions autorisées :
    //   BROUILLON → ENVOYE
    //   ENVOYE    → ACCEPTE | REFUSE
    //   (EXPIRE est automatique, pas manuel)
    // ============================================================
    static async changerStatut(req, res) {
        try {
            const { devisId } = req.params;
            const { statut, motif } = req.body;

            // -- Validation du statut cible --
            if (!statut) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ statut est obligatoire.'
                });
            }

            const statutsValides = Object.values(StatutDevis);
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: `Statut invalide. Statuts autorisés : ${statutsValides.join(', ')}.`
                });
            }

            // -- Vérification existence + isolation tenant --
            const devis = await prisma.devis.findFirst({
                where: {
                    devisId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!devis) {
                return res.status(404).json({
                    success: false,
                    message: 'Devis non trouvé.'
                });
            }

            // -- Vérification expiration avant tout changement --
            const maintenant = new Date();
            if (
                devis.dateExpiration &&
                devis.dateExpiration < maintenant &&
                devis.statut !== StatutDevis.EXPIRE
            ) {
                await prisma.devis.update({
                    where: { devisId },
                    data: { statut: StatutDevis.EXPIRE }
                });
                return res.status(409).json({
                    success: false,
                    message: 'Ce devis a expiré et ne peut plus changer de statut.'
                });
            }

            // -- Matrice des transitions autorisées --
            const transitionsAutorisees = {
                [StatutDevis.BROUILLON]: [StatutDevis.ENVOYE],
                [StatutDevis.ENVOYE]: [StatutDevis.ACCEPTE, StatutDevis.REFUSE],
                [StatutDevis.ACCEPTE]: [],
                [StatutDevis.REFUSE]: [],
                [StatutDevis.EXPIRE]: []
            };

            const statutActuel = devis.statut;
            const transitionPossible = transitionsAutorisees[statutActuel] || [];

            if (!transitionPossible.includes(statut)) {
                return res.status(409).json({
                    success: false,
                    message: `Transition de statut impossible : ${statutActuel} → ${statut}.`,
                    transitionsPossibles: transitionPossible.length > 0
                        ? transitionPossible
                        : ['Aucune transition possible depuis ce statut.']
                });
            }

            // -- Mise à jour du statut --
            const devisMisAJour = await prisma.devis.update({
                where: { devisId },
                data: { statut },
                select: {
                    devisId: true,
                    statut: true,
                    montantTotal: true,
                    remise: true,
                    dateExpiration: true,
                    dateCreation: true
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: devis.tenantId,
                    userId: req.user.userId,
                    action: 'CHANGEMENT_STATUT',
                    modele: 'Devis',
                    entiteId: devisId,
                    anciennesValeurs: { statut: statutActuel },
                    nouvellesValeurs: { statut, motif: motif || null }
                }
            });

            return res.status(200).json({
                success: true,
                message: `Statut du devis mis à jour : ${statutActuel} → ${statut}.`,
                data: devisMisAJour
            });

        } catch (error) {
            console.error('Erreur lors du changement de statut :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du changement de statut du devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // DUPLIQUER — Créer un nouveau devis depuis un devis existant
    // Accès : ADMIN, VENDEUR
    // POST /api/devis/:devisId/dupliquer
    //
    // Utile pour relancer un devis expiré ou refusé.
    // Le nouveau devis est créé au statut BROUILLON avec les mêmes
    // lignes et le même patient, mais sans dateExpiration.
    // ============================================================
    static async dupliquer(req, res) {
        try {
            const { devisId } = req.params;
            const { dateExpiration } = req.body;

            // -- Vérification existence + isolation tenant --
            const original = await prisma.devis.findFirst({
                where: {
                    devisId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    lignes: true
                }
            });

            if (!original) {
                return res.status(404).json({
                    success: false,
                    message: 'Devis original non trouvé.'
                });
            }

            // -- Validation date expiration si fournie --
            let dateExpirationParsed = null;
            if (dateExpiration) {
                dateExpirationParsed = new Date(dateExpiration);
                if (isNaN(dateExpirationParsed.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le format de dateExpiration est invalide. Utilisez le format ISO 8601.'
                    });
                }
                if (dateExpirationParsed <= new Date()) {
                    return res.status(400).json({
                        success: false,
                        message: 'La dateExpiration doit être dans le futur.'
                    });
                }
            }

            // -- Création du duplicata --
            const copie = await prisma.$transaction(async (tx) => {
                const nouveauDevis = await tx.devis.create({
                    data: {
                        tenantId: original.tenantId,
                        userId: req.user.userId,
                        patientId: original.patientId,
                        montantTotal: original.montantTotal,
                        remise: original.remise,
                        notes: original.notes,
                        dateExpiration: dateExpirationParsed,
                        statut: StatutDevis.BROUILLON
                    }
                });

                await tx.ligneDevis.createMany({
                    data: original.lignes.map((l) => ({
                        devisId: nouveauDevis.devisId,
                        produitId: l.produitId,
                        quantite: l.quantite,
                        prixUnitaire: l.prixUnitaire
                    }))
                });

                return nouveauDevis;
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: original.tenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'Devis',
                    entiteId: copie.devisId,
                    nouvellesValeurs: {
                        dupliqueDepuis: devisId,
                        montantTotal: copie.montantTotal,
                        statut: StatutDevis.BROUILLON
                    }
                }
            });

            const copieComplete = await prisma.devis.findUnique({
                where: { devisId: copie.devisId },
                include: {
                    lignes: {
                        include: {
                            produit: {
                                select: { produitId: true, reference: true, type: true, marque: true }
                            }
                        }
                    },
                    patient: { select: { patientId: true, nomComplet: true } },
                    utilisateur: { select: { userId: true, nom: true, role: true } }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Devis dupliqué avec succès.',
                data: {
                    ...copieComplete,
                    montantNet: copieComplete.montantTotal - copieComplete.remise,
                    dupliqueDepuis: devisId
                }
            });

        } catch (error) {
            console.error('Erreur lors de la duplication du devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la duplication du devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // DELETE — Supprimer un devis (BROUILLON uniquement)
    // Accès : ADMIN, SUPER_ADMIN
    // DELETE /api/devis/:devisId
    // ============================================================
    static async delete(req, res) {
        try {
            const { devisId } = req.params;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.devis.findFirst({
                where: {
                    devisId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    vente: { select: { venteId: true } }
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Devis non trouvé.'
                });
            }

            // -- Seul un devis BROUILLON peut être supprimé --
            if (existing.statut !== StatutDevis.BROUILLON) {
                return res.status(409).json({
                    success: false,
                    message: `Seul un devis au statut BROUILLON peut être supprimé. Statut actuel : ${existing.statut}.`
                });
            }

            // -- Blocage si une vente est liée (ne devrait pas arriver car BROUILLON, mais sécurité) --
            if (existing.vente) {
                return res.status(409).json({
                    success: false,
                    message: 'Ce devis a été converti en vente et ne peut pas être supprimé.'
                });
            }

            // -- Suppression (les lignes cascadent via onDelete: Cascade) --
            await prisma.devis.delete({ where: { devisId } });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'SUPPRESSION',
                    modele: 'Devis',
                    entiteId: devisId,
                    anciennesValeurs: {
                        montantTotal: existing.montantTotal,
                        remise: existing.remise,
                        statut: existing.statut,
                        patientId: existing.patientId
                    },
                    nouvellesValeurs: null
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Devis supprimé avec succès.'
            });

        } catch (error) {
            console.error('Erreur lors de la suppression du devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // SEARCH — Recherche avancée de devis
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/devis/search
    // ============================================================
    static async search(req, res) {
        try {
            const {
                patientNom,
                statut,
                montantMin,
                montantMax,
                dateDebut,
                dateFin,
                page = 1,
                limit = 10
            } = req.query;

            if (!patientNom && !statut && montantMin === undefined && montantMax === undefined && !dateDebut && !dateFin) {
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

            if (statut && Object.values(StatutDevis).includes(statut)) {
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

            const [devis, total] = await Promise.all([
                prisma.devis.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        devisId: true,
                        dateCreation: true,
                        dateExpiration: true,
                        montantTotal: true,
                        remise: true,
                        statut: true,
                        patient: {
                            select: { patientId: true, nomComplet: true, telephone: true }
                        },
                        utilisateur: {
                            select: { userId: true, nom: true }
                        },
                        vente: {
                            select: { venteId: true }
                        },
                        _count: { select: { lignes: true } }
                    },
                    orderBy: { dateCreation: 'desc' }
                }),
                prisma.devis.count({ where: whereClause })
            ]);

            const maintenant = new Date();

            return res.status(200).json({
                success: true,
                data: devis.map((d) => ({
                    ...d,
                    montantNet: d.montantTotal - d.remise,
                    convertiEnVente: !!d.vente,
                    estExpire: d.dateExpiration && d.dateExpiration < maintenant &&
                        ![StatutDevis.ACCEPTE, StatutDevis.REFUSE, StatutDevis.EXPIRE].includes(d.statut)
                })),
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la recherche de devis :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET STATS — Statistiques des devis de la boutique
    // Accès : ADMIN, VENDEUR
    // GET /api/devis/stats/global
    // Query : dateDebut, dateFin
    // ============================================================
    static async getStatsGlobal(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;

            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const dateCreationFilter = Object.keys(dateFilter).length > 0
                ? { dateCreation: dateFilter }
                : {};

            const whereClause = { ...tenantFilter, ...dateCreationFilter };

            const [
                totalDevis,
                devisParStatut,
                aggregats,
                devisConvertis,
                expiresNonMarques
            ] = await Promise.all([

                prisma.devis.count({ where: whereClause }),

                // Répartition par statut avec montants
                prisma.devis.groupBy({
                    by: ['statut'],
                    where: whereClause,
                    _count: { _all: true },
                    _sum: { montantTotal: true }
                }),

                // Agrégats financiers
                prisma.devis.aggregate({
                    where: whereClause,
                    _sum: { montantTotal: true, remise: true },
                    _avg: { montantTotal: true }
                }),

                // Devis convertis en vente
                prisma.devis.count({
                    where: { ...whereClause, vente: { isNot: null } }
                }),

                // Devis expirés non encore marqués
                prisma.devis.count({
                    where: {
                        ...tenantFilter,
                        dateExpiration: { lt: new Date() },
                        statut: { notIn: [StatutDevis.ACCEPTE, StatutDevis.REFUSE, StatutDevis.EXPIRE] }
                    }
                })
            ]);

            // -- Taux de conversion (ACCEPTE / total non-BROUILLON) --
            const devisEnvoyes = devisParStatut.find((d) => d.statut === StatutDevis.ENVOYE)?._count._all || 0;
            const devisAcceptes = devisParStatut.find((d) => d.statut === StatutDevis.ACCEPTE)?._count._all || 0;
            const devisRefuses = devisParStatut.find((d) => d.statut === StatutDevis.REFUSE)?._count._all || 0;
            const totalTraites = devisAcceptes + devisRefuses;
            const tauxConversion = totalTraites > 0
                ? Number(((devisAcceptes / totalTraites) * 100).toFixed(2))
                : null;

            // -- Formatage par statut --
            const statutsMap = devisParStatut.reduce((acc, item) => {
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
                        totalDevis,
                        devisConvertis,
                        expiresNonMarques,
                        montantTotalBrut: aggregats._sum.montantTotal || 0,
                        remiseTotale: aggregats._sum.remise || 0,
                        montantNetTotal: (aggregats._sum.montantTotal || 0) - (aggregats._sum.remise || 0),
                        montantMoyenDevis: aggregats._avg.montantTotal
                            ? Number(aggregats._avg.montantTotal.toFixed(2))
                            : 0,
                        tauxConversion
                    },
                    parStatut: statutsMap
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques des devis.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default DevisController;
