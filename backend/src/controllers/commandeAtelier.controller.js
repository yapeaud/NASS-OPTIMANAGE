import pkg from '@prisma/client';
const { Role } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * CommandeAtelierController
 * Gère le cycle de vie des commandes de montage avec isolation multi-tenant.
 *
 * Une commande atelier est un bon de travail interne destiné au MONTEUR :
 *   - Elle est créée à la suite d'une vente (venteId optionnel) ou d'une
 *     ordonnance directe (ordonnanceId optionnel)
 *   - Elle précise le type de verre et les traitements à appliquer
 *   - Elle suit un cycle de vie strict géré par le monteur et l'admin
 *   - Le MONTEUR peut créer, consulter et faire avancer ses commandes
 *
 * Cycle de vie :
 *   COMMANDE_PASSEE → EN_COURS → PRET → LIVRE
 *                  ↘          ↘       ↘
 *                   ANNULE    ANNULE  ANNULE
 *
 *   Transitions autorisées :
 *     COMMANDE_PASSEE → EN_COURS  (monteur démarre le travail)
 *     COMMANDE_PASSEE → ANNULE    (annulation avant démarrage)
 *     EN_COURS        → PRET      (montage terminé, en attente retrait)
 *     EN_COURS        → ANNULE    (annulation en cours de travail)
 *     PRET            → LIVRE     (lunettes remises au client)
 *     PRET            → ANNULE    (annulation de dernière minute)
 *
 * Permissions :
 *   ADMIN / SUPER_ADMIN : toutes les opérations
 *   VENDEUR             : créer, lire (pour rattacher à une vente)
 *   MONTEUR             : créer, lire, changer statut (dans SA boutique)
 */

// ============================================================
// Constantes — valeurs d'enum StatutAtelier & TypeVerre
// (déclarées ici car non importables depuis @prisma/client
//  si votre version Prisma ne les exporte pas directement)
// ============================================================
const STATUT_ATELIER = {
    COMMANDE_PASSEE: 'COMMANDE_PASSEE',
    EN_COURS: 'EN_COURS',
    PRET: 'PRET',
    LIVRE: 'LIVRE',
    ANNULE: 'ANNULE'
};

const TYPE_VERRE = {
    UNIFOCAL: 'UNIFOCAL',
    BIFOCAL: 'BIFOCAL',
    PROGRESSIF: 'PROGRESSIF',
    DEGRESSIF: 'DEGRESSIF'
};

// Matrice des transitions autorisées
const TRANSITIONS_AUTORISEES = {
    COMMANDE_PASSEE: ['EN_COURS', 'ANNULE'],
    EN_COURS: ['PRET', 'ANNULE'],
    PRET: ['LIVRE', 'ANNULE'],
    LIVRE: [],   // statut terminal
    ANNULE: []    // statut terminal
};

class CommandeAtelierController {

    // ============================================================
    // CREATE — Créer une nouvelle commande atelier
    // Accès : ADMIN, VENDEUR, MONTEUR
    // POST /api/commandes
    // ============================================================
    static async create(req, res) {
        try {
            const {
                typeVerre,
                traitements,
                venteId,
                ordonnanceId,
                dateExecutionJour
            } = req.body;

            // -- Validation du type de verre (obligatoire) --
            if (!typeVerre) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ typeVerre est obligatoire.'
                });
            }

            const typesValides = Object.values(TYPE_VERRE);
            if (!typesValides.includes(typeVerre)) {
                return res.status(400).json({
                    success: false,
                    message: `Type de verre invalide. Valeurs autorisées : ${typesValides.join(', ')}.`
                });
            }

            // -- Validation de la date d'exécution si fournie --
            let dateExecutionParsed = null;
            if (dateExecutionJour !== undefined && dateExecutionJour !== null) {
                dateExecutionParsed = new Date(dateExecutionJour);
                if (isNaN(dateExecutionParsed.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le format de dateExecutionJour est invalide. Utilisez le format ISO 8601.'
                    });
                }
            }

            // -- Vérification de la vente (isolation tenant) --
            if (venteId) {
                const vente = await prisma.vente.findFirst({
                    where: { venteId, tenantId: req.user.tenantId }
                });
                if (!vente) {
                    return res.status(404).json({
                        success: false,
                        message: 'Vente non trouvée dans cette boutique.'
                    });
                }
            }

            // -- Vérification de l'ordonnance (isolation tenant) --
            if (ordonnanceId) {
                const ordonnance = await prisma.ordonnance.findFirst({
                    where: { ordonnanceId, tenantId: req.user.tenantId }
                });
                if (!ordonnance) {
                    return res.status(404).json({
                        success: false,
                        message: 'Ordonnance non trouvée dans cette boutique.'
                    });
                }
            }

            // -- Création de la commande --
            const commande = await prisma.commandeAtelier.create({
                data: {
                    tenantId: req.user.tenantId,
                    userId: req.user.userId,
                    venteId: venteId || null,
                    ordonnanceId: ordonnanceId || null,
                    typeVerre,
                    traitements: traitements ? traitements.trim() : null,
                    dateExecutionJour: dateExecutionParsed,
                    statut: STATUT_ATELIER.COMMANDE_PASSEE
                },
                select: {
                    id: true,
                    commandeId: true,
                    statut: true,
                    typeVerre: true,
                    traitements: true,
                    dateExecutionJour: true,
                    tenantId: true,
                    createdAt: true,
                    utilisateur: { select: { userId: true, nom: true, role: true } },
                    vente: { select: { venteId: true, montantTotal: true, statut: true } },
                    ordonnance: { select: { ordonnanceId: true, nomMedecin: true, datePrescription: true } }
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: req.user.tenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'CommandeAtelier',
                    entiteId: commande.commandeId,
                    nouvellesValeurs: {
                        typeVerre,
                        traitements: traitements || null,
                        venteId: venteId || null,
                        ordonnanceId: ordonnanceId || null,
                        dateExecutionJour: dateExecutionParsed,
                        statut: STATUT_ATELIER.COMMANDE_PASSEE
                    }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Commande atelier créée avec succès.',
                data: commande
            });

        } catch (error) {
            console.error('Erreur lors de la création de la commande atelier :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la commande atelier.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET ALL — Lister les commandes atelier
    // Accès : Tous les rôles (filtrés par tenant sauf SUPER_ADMIN)
    // GET /api/commandes
    // Query : page, limit, statut, typeVerre, userId,
    //         venteId, ordonnanceId, dateDebut, dateFin, sortBy, order
    // ============================================================
    static async getAll(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                statut,
                typeVerre,
                userId,
                venteId,
                ordonnanceId,
                dateDebut,
                dateFin,
                sortBy = 'createdAt',
                order = 'desc'
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Filtre statut --
            const statutFilter = statut && Object.values(STATUT_ATELIER).includes(statut)
                ? { statut }
                : {};

            // -- Filtre typeVerre --
            const typeVerreFilter = typeVerre && Object.values(TYPE_VERRE).includes(typeVerre)
                ? { typeVerre }
                : {};

            // -- Filtre monteur --
            const monteurFilter = userId ? { userId } : {};

            // -- Filtre vente --
            const venteFilter = venteId ? { venteId } : {};

            // -- Filtre ordonnance --
            const ordonnanceFilter = ordonnanceId ? { ordonnanceId } : {};

            // -- Filtre plage de dates --
            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const dateCreationFilter = Object.keys(dateFilter).length > 0
                ? { createdAt: dateFilter }
                : {};

            // -- Tri sécurisé --
            const champsAutorises = ['createdAt', 'statut', 'typeVerre', 'dateExecutionJour'];
            const sortField = champsAutorises.includes(sortBy) ? sortBy : 'createdAt';
            const sortOrder = order === 'asc' ? 'asc' : 'desc';

            const whereClause = {
                ...tenantFilter,
                ...statutFilter,
                ...typeVerreFilter,
                ...monteurFilter,
                ...venteFilter,
                ...ordonnanceFilter,
                ...dateCreationFilter
            };

            const [commandes, total] = await Promise.all([
                prisma.commandeAtelier.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        commandeId: true,
                        statut: true,
                        typeVerre: true,
                        traitements: true,
                        dateExecutionJour: true,
                        tenantId: true,
                        createdAt: true,
                        utilisateur: { select: { userId: true, nom: true, role: true } },
                        vente: { select: { venteId: true, montantTotal: true, statut: true } },
                        ordonnance: { select: { ordonnanceId: true, nomMedecin: true } }
                    },
                    orderBy: { [sortField]: sortOrder }
                }),
                prisma.commandeAtelier.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: commandes,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des commandes atelier :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes atelier.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET BY ID — Détails complets d'une commande atelier
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/commandes/:commandeId
    // ============================================================
    static async getById(req, res) {
        try {
            const { commandeId } = req.params;

            const commande = await prisma.commandeAtelier.findFirst({
                where: {
                    commandeId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    utilisateur: { select: { userId: true, nom: true, role: true } },
                    vente: {
                        select: {
                            venteId: true,
                            montantTotal: true,
                            remise: true,
                            resteAPayer: true,
                            statut: true,
                            dateCreation: true,
                            patient: { select: { patientId: true, nomComplet: true, telephone: true } }
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
                            additionOD: true,
                            sphereOG: true,
                            cylindreOG: true,
                            axeOG: true,
                            additionOG: true,
                            patient: { select: { patientId: true, nomComplet: true } }
                        }
                    }
                }
            });

            if (!commande) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande atelier non trouvée.'
                });
            }

            // -- Calcul des transitions disponibles --
            const transitionsDisponibles = TRANSITIONS_AUTORISEES[commande.statut] || [];

            return res.status(200).json({
                success: true,
                data: {
                    ...commande,
                    transitionsDisponibles
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération de la commande atelier :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la commande atelier.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // UPDATE — Modifier les informations d'une commande
    // Accès : ADMIN, MONTEUR (même tenant)
    // PATCH /api/commandes/:commandeId
    //
    // Modifie uniquement les champs non liés au statut :
    //   typeVerre, traitements, dateExecutionJour
    // Pour changer le statut → utiliser changerStatut.
    // ============================================================
    static async update(req, res) {
        try {
            const { commandeId } = req.params;
            const { typeVerre, traitements, dateExecutionJour } = req.body;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.commandeAtelier.findFirst({
                where: {
                    commandeId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande atelier non trouvée.'
                });
            }

            // -- Blocage si statut terminal --
            if (existing.statut === STATUT_ATELIER.LIVRE || existing.statut === STATUT_ATELIER.ANNULE) {
                return res.status(409).json({
                    success: false,
                    message: `Une commande au statut "${existing.statut}" ne peut plus être modifiée.`
                });
            }

            // -- Validation typeVerre si fourni --
            if (typeVerre !== undefined) {
                const typesValides = Object.values(TYPE_VERRE);
                if (!typesValides.includes(typeVerre)) {
                    return res.status(400).json({
                        success: false,
                        message: `Type de verre invalide. Valeurs autorisées : ${typesValides.join(', ')}.`
                    });
                }
            }

            // -- Validation date si fournie --
            let dateExecutionParsed = undefined;
            if (dateExecutionJour !== undefined) {
                if (dateExecutionJour === null) {
                    dateExecutionParsed = null;
                } else {
                    dateExecutionParsed = new Date(dateExecutionJour);
                    if (isNaN(dateExecutionParsed.getTime())) {
                        return res.status(400).json({
                            success: false,
                            message: 'Le format de dateExecutionJour est invalide. Utilisez le format ISO 8601.'
                        });
                    }
                }
            }

            // -- Construction des données à mettre à jour --
            const updateData = {};
            if (typeVerre !== undefined) updateData.typeVerre = typeVerre;
            if (traitements !== undefined) updateData.traitements = traitements ? traitements.trim() : null;
            if (dateExecutionParsed !== undefined) updateData.dateExecutionJour = dateExecutionParsed;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune donnée à mettre à jour.'
                });
            }

            const updated = await prisma.commandeAtelier.update({
                where: { commandeId },
                data: updateData,
                select: {
                    id: true,
                    commandeId: true,
                    statut: true,
                    typeVerre: true,
                    traitements: true,
                    dateExecutionJour: true,
                    utilisateur: { select: { userId: true, nom: true, role: true } }
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'MODIFICATION',
                    modele: 'CommandeAtelier',
                    entiteId: commandeId,
                    anciennesValeurs: {
                        typeVerre: existing.typeVerre,
                        traitements: existing.traitements,
                        dateExecutionJour: existing.dateExecutionJour
                    },
                    nouvellesValeurs: updateData
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Commande atelier mise à jour avec succès.',
                data: updated
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour de la commande atelier :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de la commande atelier.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // CHANGER STATUT — Faire avancer une commande dans son cycle
    // Accès : ADMIN, MONTEUR (même tenant)
    // PATCH /api/commandes/:commandeId/statut
    //
    // Corps : { statut: 'EN_COURS' | 'PRET' | 'LIVRE' | 'ANNULE',
    //           motif?: string (obligatoire si statut=ANNULE) }
    //
    // Transitions valides :
    //   COMMANDE_PASSEE → EN_COURS | ANNULE
    //   EN_COURS        → PRET     | ANNULE
    //   PRET            → LIVRE    | ANNULE
    //   LIVRE / ANNULE  → (aucune, statut terminal)
    // ============================================================
    static async changerStatut(req, res) {
        try {
            const { commandeId } = req.params;
            const { statut: nouveauStatut, motif } = req.body;

            // -- Validation du nouveau statut --
            if (!nouveauStatut) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ statut est obligatoire.'
                });
            }

            if (!Object.values(STATUT_ATELIER).includes(nouveauStatut)) {
                return res.status(400).json({
                    success: false,
                    message: `Statut invalide. Valeurs autorisées : ${Object.values(STATUT_ATELIER).join(', ')}.`
                });
            }

            // -- Motif obligatoire pour une annulation --
            if (nouveauStatut === STATUT_ATELIER.ANNULE && (!motif || !motif.trim())) {
                return res.status(400).json({
                    success: false,
                    message: 'Le motif est obligatoire pour annuler une commande atelier.'
                });
            }

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.commandeAtelier.findFirst({
                where: {
                    commandeId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande atelier non trouvée.'
                });
            }

            // -- Vérification que la transition est autorisée --
            const transitionsAutorisees = TRANSITIONS_AUTORISEES[existing.statut] || [];
            if (!transitionsAutorisees.includes(nouveauStatut)) {
                const estTerminal = existing.statut === STATUT_ATELIER.LIVRE || existing.statut === STATUT_ATELIER.ANNULE;
                return res.status(409).json({
                    success: false,
                    message: estTerminal
                        ? `Le statut "${existing.statut}" est terminal : aucune transition n'est possible.`
                        : `Transition impossible de "${existing.statut}" vers "${nouveauStatut}". Transitions autorisées : ${transitionsAutorisees.join(', ')}.`,
                    statutActuel: existing.statut,
                    transitionsAutorisees
                });
            }

            // -- Mise à jour --
            const updated = await prisma.commandeAtelier.update({
                where: { commandeId },
                data: { statut: nouveauStatut },
                select: {
                    id: true,
                    commandeId: true,
                    statut: true,
                    typeVerre: true,
                    traitements: true,
                    dateExecutionJour: true,
                    utilisateur: { select: { userId: true, nom: true, role: true } }
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'CHANGEMENT_STATUT',
                    modele: 'CommandeAtelier',
                    entiteId: commandeId,
                    anciennesValeurs: { statut: existing.statut },
                    nouvellesValeurs: {
                        statut: nouveauStatut,
                        ...(motif ? { motif: motif.trim() } : {})
                    }
                }
            });

            // -- Message contextuel selon la transition --
            const messages = {
                EN_COURS: 'Commande prise en charge par l\'atelier.',
                PRET: 'Commande terminée, lunettes prêtes à être remises au client.',
                LIVRE: 'Lunettes livrées au client. Commande clôturée.',
                ANNULE: 'Commande atelier annulée.'
            };

            return res.status(200).json({
                success: true,
                message: messages[nouveauStatut] || 'Statut mis à jour avec succès.',
                data: updated
            });

        } catch (error) {
            console.error('Erreur lors du changement de statut :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du changement de statut de la commande atelier.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // MES COMMANDES — Commandes assignées au monteur connecté
    // Accès : MONTEUR, ADMIN
    // GET /api/commandes/mes-commandes
    // Query : statut, page, limit
    // ============================================================
    static async mesCommandes(req, res) {
        try {
            const { statut, page = 1, limit = 10 } = req.query;
            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtrage —
            // MONTEUR : ses propres commandes dans SA boutique
            // ADMIN   : toutes les commandes de la boutique (vue équipe)
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            const userFilter = req.user.role === Role.MONTEUR
                ? { userId: req.user.userId }
                : {};

            const statutFilter = statut && Object.values(STATUT_ATELIER).includes(statut)
                ? { statut }
                : {};

            const whereClause = {
                ...tenantFilter,
                ...userFilter,
                ...statutFilter
            };

            const [commandes, total] = await Promise.all([
                prisma.commandeAtelier.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        commandeId: true,
                        statut: true,
                        typeVerre: true,
                        traitements: true,
                        dateExecutionJour: true,
                        createdAt: true,
                        utilisateur: { select: { userId: true, nom: true } },
                        vente: {
                            select: {
                                venteId: true,
                                patient: { select: { patientId: true, nomComplet: true } }
                            }
                        },
                        ordonnance: {
                            select: {
                                ordonnanceId: true,
                                nomMedecin: true,
                                patient: { select: { patientId: true, nomComplet: true } }
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }),
                prisma.commandeAtelier.count({ where: whereClause })
            ]);

            // -- Enrichissement : transitions disponibles par commande --
            const commandesEnrichies = commandes.map((c) => ({
                ...c,
                transitionsDisponibles: TRANSITIONS_AUTORISEES[c.statut] || []
            }));

            return res.status(200).json({
                success: true,
                data: commandesEnrichies,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des commandes :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET STATS GLOBAL — Tableau de bord atelier
    // Accès : ADMIN, VENDEUR
    // GET /api/commandes/stats/global
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
                ? { createdAt: dateFilter }
                : {};

            const whereClause = { ...tenantFilter, ...dateCreationFilter };

            const [
                totalCommandes,
                commandesParStatut,
                commandesParType,
                commandesEnAttente,
                commandesParMonteur,
                commandesEnRetard
            ] = await Promise.all([

                // Total toutes commandes
                prisma.commandeAtelier.count({ where: whereClause }),

                // Répartition par statut
                prisma.commandeAtelier.groupBy({
                    by: ['statut'],
                    where: whereClause,
                    _count: { _all: true }
                }),

                // Répartition par type de verre
                prisma.commandeAtelier.groupBy({
                    by: ['typeVerre'],
                    where: whereClause,
                    _count: { _all: true }
                }),

                // Commandes actives (pas terminées, pas annulées)
                prisma.commandeAtelier.count({
                    where: {
                        ...tenantFilter,
                        statut: { in: [STATUT_ATELIER.COMMANDE_PASSEE, STATUT_ATELIER.EN_COURS, STATUT_ATELIER.PRET] }
                    }
                }),

                // Production par monteur (top 5)
                prisma.commandeAtelier.groupBy({
                    by: ['userId'],
                    where: { ...tenantFilter, ...dateCreationFilter, statut: STATUT_ATELIER.LIVRE },
                    _count: { _all: true },
                    orderBy: { _count: { commandeId: 'desc' } },
                    take: 5
                }),

                // Commandes en retard (dateExecutionJour dépassée et pas encore livrées)
                prisma.commandeAtelier.count({
                    where: {
                        ...tenantFilter,
                        statut: { in: [STATUT_ATELIER.COMMANDE_PASSEE, STATUT_ATELIER.EN_COURS] },
                        dateExecutionJour: { lt: new Date() }
                    }
                })
            ]);

            // -- Formatage répartition par statut --
            const parStatut = commandesParStatut.reduce((acc, item) => {
                acc[item.statut] = item._count._all;
                return acc;
            }, {});

            // -- Formatage répartition par type de verre --
            const parTypeVerre = commandesParType.reduce((acc, item) => {
                acc[item.typeVerre] = item._count._all;
                return acc;
            }, {});

            // -- Enrichissement top monteurs --
            const topMonteurs = await Promise.all(
                commandesParMonteur.map(async (item) => {
                    const utilisateur = await prisma.utilisateur.findUnique({
                        where: { userId: item.userId },
                        select: { userId: true, nom: true, role: true }
                    });
                    return {
                        ...utilisateur,
                        commandesLivrees: item._count._all
                    };
                })
            );

            return res.status(200).json({
                success: true,
                data: {
                    periode: {
                        dateDebut: dateDebut || null,
                        dateFin: dateFin || null
                    },
                    resume: {
                        totalCommandes,
                        commandesActives: commandesEnAttente,
                        commandesEnRetard,
                        commandesTerminees: (parStatut[STATUT_ATELIER.LIVRE] || 0),
                        commandesAnnulees: (parStatut[STATUT_ATELIER.ANNULE] || 0)
                    },
                    parStatut,
                    parTypeVerre,
                    topMonteurs
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques atelier :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques atelier.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default CommandeAtelierController;