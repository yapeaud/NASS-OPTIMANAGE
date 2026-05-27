import pkg from '@prisma/client';
const { Prisma } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * PatientController
 * Gère les opérations CRUD sur les patients avec isolation multi-tenant.
 * 
 * Un patient appartient strictement à une boutique (tenantId).
 * Toutes les requêtes sont filtrées par le tenantId de l'utilisateur connecté,
 * sauf pour le SUPER_ADMIN qui peut tout voir.
 */
class PatientController {

    // ============================================================
    // CREATE — Créer un nouveau patient
    // Accès : ADMIN, VENDEUR
    // POST /api/patients
    // ============================================================
    static async create(req, res) {
        try {
            const {
                nomComplet,
                telephone,
                profession,
                dateNaissance,
                nomAssurance,
                numeroAssurance
            } = req.body;

            // -- Validation des champs obligatoires --
            if (!nomComplet || !nomComplet.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Le champ nomComplet est obligatoire.'
                });
            }

            // -- Validation du format de date --
            let dateNaissanceParsed = null;
            if (dateNaissance) {
                dateNaissanceParsed = new Date(dateNaissance);
                if (isNaN(dateNaissanceParsed.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le format de dateNaissance est invalide. Utilisez le format ISO 8601 (ex: 1990-05-15).'
                    });
                }
                // La date de naissance ne peut pas être dans le futur
                if (dateNaissanceParsed > new Date()) {
                    return res.status(400).json({
                        success: false,
                        message: 'La date de naissance ne peut pas être dans le futur.'
                    });
                }
            }

            // -- Validation cohérence assurance : les deux champs vont de pair --
            if (nomAssurance && !numeroAssurance) {
                return res.status(400).json({
                    success: false,
                    message: 'Le numéro d\'assurance est requis lorsque le nom d\'assurance est fourni.'
                });
            }
            if (numeroAssurance && !nomAssurance) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom d\'assurance est requis lorsque le numéro d\'assurance est fourni.'
                });
            }

            // -- Création du patient --
            const patient = await prisma.patient.create({
                data: {
                    nomComplet: nomComplet.trim(),
                    telephone: telephone ? telephone.trim() : null,
                    profession: profession ? profession.trim() : null,
                    dateNaissance: dateNaissanceParsed,
                    nomAssurance: nomAssurance ? nomAssurance.trim() : null,
                    numeroAssurance: numeroAssurance ? numeroAssurance.trim() : null,
                    tenantId: req.user.tenantId
                },
                select: {
                    id: true,
                    patientId: true,
                    nomComplet: true,
                    telephone: true,
                    profession: true,
                    dateNaissance: true,
                    nomAssurance: true,
                    numeroAssurance: true,
                    createdAt: true,
                    tenantId: true
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: req.user.tenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'Patient',
                    entiteId: patient.patientId,
                    nouvellesValeurs: {
                        nomComplet: patient.nomComplet,
                        telephone: patient.telephone,
                        profession: patient.profession,
                        dateNaissance: patient.dateNaissance,
                        nomAssurance: patient.nomAssurance,
                        numeroAssurance: patient.numeroAssurance
                    }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Patient créé avec succès.',
                data: patient
            });

        } catch (error) {
            console.error('Erreur lors de la création du patient :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET ALL — Lister les patients
    // Accès : Tous les rôles (filtrés par tenant sauf SUPER_ADMIN)
    // GET /api/patients
    // Query params : page, limit, search, assurance
    // ============================================================
    static async getAll(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                search,        // recherche sur nomComplet, telephone, profession
                assurance,     // 'true' → patients avec assurance, 'false' → sans
                sortBy = 'createdAt',
                order = 'desc'
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant (SUPER_ADMIN voit tout) --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Filtre de recherche plein-texte --
            const searchFilter = search
                ? {
                    OR: [
                        { nomComplet: { contains: search, mode: 'insensitive' } },
                        { telephone: { contains: search, mode: 'insensitive' } },
                        { profession: { contains: search, mode: 'insensitive' } },
                        { nomAssurance: { contains: search, mode: 'insensitive' } }
                    ]
                }
                : {};

            // -- Filtre assurance --
            const assuranceFilter =
                assurance === 'true' ? { nomAssurance: { not: null } } :
                    assurance === 'false' ? { nomAssurance: null } :
                        {};

            // -- Tri --
            const champsAutorisés = ['nomComplet', 'createdAt', 'dateNaissance'];
            const sortField = champsAutorisés.includes(sortBy) ? sortBy : 'createdAt';
            const sortOrder = order === 'asc' ? 'asc' : 'desc';

            const whereClause = {
                ...tenantFilter,
                ...searchFilter,
                ...assuranceFilter
            };

            const [patients, total] = await Promise.all([
                prisma.patient.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        patientId: true,
                        nomComplet: true,
                        telephone: true,
                        profession: true,
                        dateNaissance: true,
                        nomAssurance: true,
                        numeroAssurance: true,
                        createdAt: true,
                        tenantId: true,
                        _count: {
                            select: {
                                ordonnances: true,
                                ventes: true,
                                devis: true
                            }
                        }
                    },
                    orderBy: { [sortField]: sortOrder }
                }),
                prisma.patient.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: patients,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des patients :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des patients.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET BY ID — Détails d'un patient
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/patients/:patientId
    // ============================================================
    static async getById(req, res) {
        try {
            const { patientId } = req.params;

            const whereClause = {
                patientId,
                ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
            };

            const patient = await prisma.patient.findFirst({
                where: whereClause,
                select: {
                    id: true,
                    patientId: true,
                    nomComplet: true,
                    telephone: true,
                    profession: true,
                    dateNaissance: true,
                    nomAssurance: true,
                    numeroAssurance: true,
                    createdAt: true,
                    tenantId: true,
                    _count: {
                        select: {
                            ordonnances: true,
                            ventes: true,
                            devis: true
                        }
                    }
                }
            });

            if (!patient) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient non trouvé.'
                });
            }

            return res.status(200).json({
                success: true,
                data: patient
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du patient :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // UPDATE — Modifier un patient
    // Accès : ADMIN, VENDEUR (même tenant)
    // PATCH /api/patients/:patientId
    // ============================================================
    static async update(req, res) {
        try {
            const { patientId } = req.params;
            const {
                nomComplet,
                telephone,
                profession,
                dateNaissance,
                nomAssurance,
                numeroAssurance
            } = req.body;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.patient.findFirst({
                where: {
                    patientId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient non trouvé.'
                });
            }

            // -- Validation date de naissance si fournie --
            let dateNaissanceParsed = undefined;
            if (dateNaissance !== undefined) {
                if (dateNaissance === null) {
                    dateNaissanceParsed = null;
                } else {
                    dateNaissanceParsed = new Date(dateNaissance);
                    if (isNaN(dateNaissanceParsed.getTime())) {
                        return res.status(400).json({
                            success: false,
                            message: 'Le format de dateNaissance est invalide. Utilisez le format ISO 8601 (ex: 1990-05-15).'
                        });
                    }
                    if (dateNaissanceParsed > new Date()) {
                        return res.status(400).json({
                            success: false,
                            message: 'La date de naissance ne peut pas être dans le futur.'
                        });
                    }
                }
            }

            // -- Construction de l'objet de mise à jour (champs fournis uniquement) --
            const updateData = {};
            if (nomComplet !== undefined) updateData.nomComplet = nomComplet.trim();
            if (telephone !== undefined) updateData.telephone = telephone ? telephone.trim() : null;
            if (profession !== undefined) updateData.profession = profession ? profession.trim() : null;
            if (dateNaissanceParsed !== undefined) updateData.dateNaissance = dateNaissanceParsed;
            if (nomAssurance !== undefined) updateData.nomAssurance = nomAssurance ? nomAssurance.trim() : null;
            if (numeroAssurance !== undefined) updateData.numeroAssurance = numeroAssurance ? numeroAssurance.trim() : null;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune donnée à mettre à jour.'
                });
            }

            // -- Vérification cohérence assurance après fusion --
            const nomAssuranceFinal = updateData.nomAssurance ?? existing.nomAssurance;
            const numeroAssuranceFinal = updateData.numeroAssurance ?? existing.numeroAssurance;
            if (nomAssuranceFinal && !numeroAssuranceFinal) {
                return res.status(400).json({
                    success: false,
                    message: 'Le numéro d\'assurance est requis lorsque le nom d\'assurance est fourni.'
                });
            }
            if (numeroAssuranceFinal && !nomAssuranceFinal) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom d\'assurance est requis lorsque le numéro d\'assurance est fourni.'
                });
            }

            // -- Mise à jour --
            const updated = await prisma.patient.update({
                where: { patientId },
                data: updateData,
                select: {
                    id: true,
                    patientId: true,
                    nomComplet: true,
                    telephone: true,
                    profession: true,
                    dateNaissance: true,
                    nomAssurance: true,
                    numeroAssurance: true,
                    createdAt: true,
                    tenantId: true
                }
            });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'MODIFICATION',
                    modele: 'Patient',
                    entiteId: patientId,
                    anciennesValeurs: {
                        nomComplet: existing.nomComplet,
                        telephone: existing.telephone,
                        profession: existing.profession,
                        dateNaissance: existing.dateNaissance,
                        nomAssurance: existing.nomAssurance,
                        numeroAssurance: existing.numeroAssurance
                    },
                    nouvellesValeurs: updateData
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Patient mis à jour avec succès.',
                data: updated
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour du patient :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // DELETE — Supprimer un patient
    // Accès : ADMIN, SUPER_ADMIN
    // DELETE /api/patients/:patientId
    //
    // ⚠️  Prisma bloquera la suppression si le patient possède des
    //     ordonnances ou des ventes (onDelete: Cascade côté Patient
    //     supprime les ordonnances, mais les ventes référencent le
    //     patient avec onDelete: SetNull — la suppression reste donc
    //     possible). On vérifie manuellement pour avertir l'appelant.
    // ============================================================
    static async delete(req, res) {
        try {
            const { patientId } = req.params;

            // -- Vérification existence + isolation tenant --
            const existing = await prisma.patient.findFirst({
                where: {
                    patientId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                },
                include: {
                    _count: {
                        select: {
                            ventes: true,
                            ordonnances: true,
                            devis: true
                        }
                    }
                }
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient non trouvé.'
                });
            }

            // -- Avertissement si le patient a un historique métier --
            const totalActivite =
                existing._count.ventes +
                existing._count.ordonnances +
                existing._count.devis;

            if (totalActivite > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Impossible de supprimer ce patient : il possède un historique métier (ventes, ordonnances ou devis). Archivez-le plutôt.',
                    details: {
                        ventes: existing._count.ventes,
                        ordonnances: existing._count.ordonnances,
                        devis: existing._count.devis
                    }
                });
            }

            // -- Suppression --
            await prisma.patient.delete({ where: { patientId } });

            // -- Traçabilité --
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId,
                    userId: req.user.userId,
                    action: 'SUPPRESSION',
                    modele: 'Patient',
                    entiteId: patientId,
                    anciennesValeurs: {
                        nomComplet: existing.nomComplet,
                        telephone: existing.telephone,
                        profession: existing.profession,
                        dateNaissance: existing.dateNaissance
                    },
                    nouvellesValeurs: null
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Patient supprimé avec succès.'
            });

        } catch (error) {
            console.error('Erreur lors de la suppression du patient :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET HISTORIQUE — Ordonnances, ventes et devis d'un patient
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/patients/:patientId/historique
    // ============================================================
    static async getHistorique(req, res) {
        try {
            const { patientId } = req.params;

            // -- Vérification existence + isolation tenant --
            const patient = await prisma.patient.findFirst({
                where: {
                    patientId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!patient) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient non trouvé.'
                });
            }

            // -- Récupération parallèle des 3 collections --
            const [ordonnances, ventes, devis] = await Promise.all([

                prisma.ordonnance.findMany({
                    where: { patientId, tenantId: patient.tenantId },
                    select: {
                        ordonnanceId: true,
                        datePrescription: true,
                        nomMedecin: true,
                        sphereOD: true,
                        cylindreOD: true,
                        axeOD: true,
                        additionOD: true,
                        ecartPupillaireOD: true,
                        sphereOG: true,
                        cylindreOG: true,
                        axeOG: true,
                        additionOG: true,
                        ecartPupillaireOG: true,
                        utilisateur: {
                            select: { nom: true, role: true }
                        },
                        _count: {
                            select: { ventes: true, commandes: true }
                        }
                    },
                    orderBy: { datePrescription: 'desc' }
                }),

                prisma.vente.findMany({
                    where: { patientId, tenantId: patient.tenantId },
                    select: {
                        venteId: true,
                        dateCreation: true,
                        montantTotal: true,
                        remise: true,
                        resteAPayer: true,
                        statut: true,
                        utilisateur: { select: { nom: true } },
                        lignes: {
                            select: {
                                quantite: true,
                                prixUnitaire: true,
                                produit: {
                                    select: { reference: true, type: true, marque: true }
                                }
                            }
                        },
                        paiements: {
                            select: {
                                montant: true,
                                methode: true,
                                datePaiement: true
                            }
                        }
                    },
                    orderBy: { dateCreation: 'desc' }
                }),

                prisma.devis.findMany({
                    where: { patientId, tenantId: patient.tenantId },
                    select: {
                        devisId: true,
                        dateCreation: true,
                        dateExpiration: true,
                        montantTotal: true,
                        remise: true,
                        statut: true,
                        notes: true,
                        utilisateur: { select: { nom: true } },
                        lignes: {
                            select: {
                                quantite: true,
                                prixUnitaire: true,
                                produit: {
                                    select: { reference: true, type: true, marque: true }
                                }
                            }
                        }
                    },
                    orderBy: { dateCreation: 'desc' }
                })
            ]);

            return res.status(200).json({
                success: true,
                data: {
                    patient: {
                        patientId: patient.patientId,
                        nomComplet: patient.nomComplet
                    },
                    ordonnances,
                    ventes,
                    devis,
                    resume: {
                        totalOrdonnances: ordonnances.length,
                        totalVentes: ventes.length,
                        totalDevis: devis.length,
                        montantTotalVentes: ventes.reduce((sum, v) => sum + v.montantTotal, 0)
                    }
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération de l\'historique :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de l\'historique du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET ORDONNANCES — Ordonnances d'un patient
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/patients/:patientId/ordonnances
    // ============================================================
    static async getOrdonnances(req, res) {
        try {
            const { patientId } = req.params;
            const { page = 1, limit = 10 } = req.query;
            const skip = (Number(page) - 1) * Number(limit);

            // -- Vérification existence + isolation tenant --
            const patient = await prisma.patient.findFirst({
                where: {
                    patientId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!patient) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient non trouvé.'
                });
            }

            const [ordonnances, total] = await Promise.all([
                prisma.ordonnance.findMany({
                    where: { patientId, tenantId: patient.tenantId },
                    skip,
                    take: Number(limit),
                    select: {
                        ordonnanceId: true,
                        datePrescription: true,
                        nomMedecin: true,
                        sphereOD: true,
                        cylindreOD: true,
                        axeOD: true,
                        additionOD: true,
                        ecartPupillaireOD: true,
                        sphereOG: true,
                        cylindreOG: true,
                        axeOG: true,
                        additionOG: true,
                        ecartPupillaireOG: true,
                        utilisateur: { select: { nom: true, role: true } },
                        _count: {
                            select: { ventes: true, commandes: true }
                        }
                    },
                    orderBy: { datePrescription: 'desc' }
                }),
                prisma.ordonnance.count({ where: { patientId, tenantId: patient.tenantId } })
            ]);

            return res.status(200).json({
                success: true,
                data: ordonnances,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des ordonnances :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des ordonnances du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // GET STATS — Statistiques d'un patient
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/patients/:patientId/stats
    // ============================================================
    static async getStats(req, res) {
        try {
            const { patientId } = req.params;

            // -- Vérification existence + isolation tenant --
            const patient = await prisma.patient.findFirst({
                where: {
                    patientId,
                    ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
                }
            });

            if (!patient) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient non trouvé.'
                });
            }

            const tenantId = patient.tenantId;

            const [
                totalOrdonnances,
                totalVentes,
                totalDevis,
                montantVentes,
                dernierOrdonnance,
                derniereVente,
                ventesParStatut,
                devisParStatut
            ] = await Promise.all([
                prisma.ordonnance.count({ where: { patientId, tenantId } }),
                prisma.vente.count({ where: { patientId, tenantId } }),
                prisma.devis.count({ where: { patientId, tenantId } }),
                prisma.vente.aggregate({
                    where: { patientId, tenantId },
                    _sum: { montantTotal: true, remise: true, resteAPayer: true }
                }),
                prisma.ordonnance.findFirst({
                    where: { patientId, tenantId },
                    orderBy: { datePrescription: 'desc' },
                    select: { ordonnanceId: true, datePrescription: true, nomMedecin: true }
                }),
                prisma.vente.findFirst({
                    where: { patientId, tenantId },
                    orderBy: { dateCreation: 'desc' },
                    select: { venteId: true, dateCreation: true, montantTotal: true, statut: true }
                }),
                prisma.vente.groupBy({
                    by: ['statut'],
                    where: { patientId, tenantId },
                    _count: { _all: true }
                }),
                prisma.devis.groupBy({
                    by: ['statut'],
                    where: { patientId, tenantId },
                    _count: { _all: true }
                })
            ]);

            // -- Formatage des groupBy en objets lisibles --
            const ventesParStatutMap = ventesParStatut.reduce((acc, item) => {
                acc[item.statut] = item._count._all;
                return acc;
            }, {});

            const devisParStatutMap = devisParStatut.reduce((acc, item) => {
                acc[item.statut] = item._count._all;
                return acc;
            }, {});

            return res.status(200).json({
                success: true,
                data: {
                    ordonnances: {
                        total: totalOrdonnances,
                        dernier: dernierOrdonnance
                    },
                    ventes: {
                        total: totalVentes,
                        montantTotal: montantVentes._sum.montantTotal || 0,
                        remiseTotal: montantVentes._sum.remise || 0,
                        resteAPayer: montantVentes._sum.resteAPayer || 0,
                        parStatut: ventesParStatutMap,
                        derniere: derniereVente
                    },
                    devis: {
                        total: totalDevis,
                        parStatut: devisParStatutMap
                    }
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques du patient.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ============================================================
    // SEARCH — Recherche avancée
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/patients/search
    // ============================================================
    static async search(req, res) {
        try {
            const {
                q,               // terme libre (nomComplet, téléphone, profession)
                nomAssurance,    // filtrer sur une assurance précise
                dateNaissanceMin,
                dateNaissanceMax,
                page = 1,
                limit = 10
            } = req.query;

            if (!q && !nomAssurance && !dateNaissanceMin && !dateNaissanceMax) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un critère de recherche est requis (q, nomAssurance, dateNaissanceMin ou dateNaissanceMax).'
                });
            }

            const skip = (Number(page) - 1) * Number(limit);

            // -- Filtre tenant --
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // -- Construction des filtres optionnels --
            const filters = [];

            if (q) {
                filters.push({
                    OR: [
                        { nomComplet: { contains: q, mode: 'insensitive' } },
                        { telephone: { contains: q, mode: 'insensitive' } },
                        { profession: { contains: q, mode: 'insensitive' } }
                    ]
                });
            }

            if (nomAssurance) {
                filters.push({
                    nomAssurance: { contains: nomAssurance, mode: 'insensitive' }
                });
            }

            if (dateNaissanceMin || dateNaissanceMax) {
                const rangeDate = {};
                if (dateNaissanceMin) rangeDate.gte = new Date(dateNaissanceMin);
                if (dateNaissanceMax) rangeDate.lte = new Date(dateNaissanceMax);
                filters.push({ dateNaissance: rangeDate });
            }

            const whereClause = {
                ...tenantFilter,
                ...(filters.length > 0 ? { AND: filters } : {})
            };

            const [patients, total] = await Promise.all([
                prisma.patient.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        patientId: true,
                        nomComplet: true,
                        telephone: true,
                        profession: true,
                        dateNaissance: true,
                        nomAssurance: true,
                        numeroAssurance: true,
                        createdAt: true,
                        _count: {
                            select: {
                                ordonnances: true,
                                ventes: true
                            }
                        }
                    },
                    orderBy: { nomComplet: 'asc' }
                }),
                prisma.patient.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: patients,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la recherche de patients :', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default PatientController;
