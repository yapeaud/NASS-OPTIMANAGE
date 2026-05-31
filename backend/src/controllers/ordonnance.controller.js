import pkg from '@prisma/client';
const { Role } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * OrdonnanceController
 * Gère les opérations CRUD sur les ordonnances optiques avec isolation multi-tenant.
 *
 * Une ordonnance est le document médical de référence délivré par un ophtalmologue :
 *   - Elle contient les mesures réfractives binoculaires (OD + OG)
 *   - Elle est rattachée à un patient et enregistrée par un utilisateur
 *   - Elle peut être liée à une ou plusieurs ventes et commandes atelier
 *   - La suppression est protégée si des ventes ou commandes en dépendent
 *
 * Champs optiques (par œil, OD = droit, OG = gauche) :
 *   sphere           : puissance sphérique (myopie < 0, hypermétropie > 0)
 *   cylindre         : puissance cylindrique (astigmatisme)
 *   axe              : orientation du cylindre en degrés (0-180)
 *   addition         : correction de près (presbytie, > 0)
 *   ecartPupillaire  : distance interpupillaire en mm
 */

class OrdonnanceController {

    // ============================================================
    // HELPERS INTERNES
    // ============================================================

    static _validerMesuresOptiques(mesures) {
        const {
            sphereOD, cylindreOD, axeOD, additionOD, ecartPupillaireOD,
            sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG
        } = mesures;

        for (const [nom, valeur] of [['axeOD', axeOD], ['axeOG', axeOG]]) {
            if (valeur !== undefined && valeur !== null) {
                const v = Number(valeur);
                if (isNaN(v) || v < 0 || v > 180) {
                    return { valid: false, message: `${nom} doit être un nombre entre 0 et 180 degrés.` };
                }
            }
        }

        for (const [nom, valeur] of [['additionOD', additionOD], ['additionOG', additionOG]]) {
            if (valeur !== undefined && valeur !== null) {
                const v = Number(valeur);
                if (isNaN(v) || v < 0) {
                    return { valid: false, message: `${nom} doit être un nombre positif ou nul.` };
                }
            }
        }

        for (const [nom, valeur] of [['ecartPupillaireOD', ecartPupillaireOD], ['ecartPupillaireOG', ecartPupillaireOG]]) {
            if (valeur !== undefined && valeur !== null) {
                const v = Number(valeur);
                if (isNaN(v) || v < 20 || v > 45) {
                    return { valid: false, message: `${nom} doit être un nombre entre 20 et 45 mm.` };
                }
            }
        }

        for (const [nom, valeur] of [['sphereOD', sphereOD], ['sphereOG', sphereOG]]) {
            if (valeur !== undefined && valeur !== null) {
                const v = Number(valeur);
                if (isNaN(v) || v < -30 || v > 30) {
                    return { valid: false, message: `${nom} doit être un nombre entre -30 et +30 dioptries.` };
                }
            }
        }

        for (const [nom, valeur] of [['cylindreOD', cylindreOD], ['cylindreOG', cylindreOG]]) {
            if (valeur !== undefined && valeur !== null) {
                const v = Number(valeur);
                if (isNaN(v) || v < -10 || v > 10) {
                    return { valid: false, message: `${nom} doit être un nombre entre -10 et +10 dioptries.` };
                }
            }
        }

        return { valid: true };
    }

    static _calculerEvolution(ancien, nouveau) {
        if (ancien === null || ancien === undefined || nouveau === null || nouveau === undefined) {
            return { ancien, nouveau, difference: null, tendance: 'N/A' };
        }
        const diff = Number((nouveau - ancien).toFixed(2));
        let tendance = 'Stable';
        if (diff > 0) tendance = 'Augmentation';
        if (diff < 0) tendance = 'Diminution';
        return { ancien, nouveau, difference: diff, tendance };
    }

    // ============================================================
    // CREATE — Créer une nouvelle ordonnance
    // Accès : ADMIN, VENDEUR
    // POST /api/ordonnances
    // ============================================================
    static async create(req, res) {
        try {
            const {
                patientId, datePrescription, nomMedecin,
                sphereOD, cylindreOD, axeOD, additionOD, ecartPupillaireOD,
                sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG
            } = req.body;

            if (!patientId) {
                return res.status(400).json({ success: false, message: 'Le champ patientId est obligatoire.' });
            }
            if (!datePrescription) {
                return res.status(400).json({ success: false, message: 'Le champ datePrescription est obligatoire.' });
            }
            if (!nomMedecin || !nomMedecin.trim()) {
                return res.status(400).json({ success: false, message: 'Le champ nomMedecin est obligatoire.' });
            }

            const datePrescriptionParsed = new Date(datePrescription);
            if (isNaN(datePrescriptionParsed.getTime())) {
                return res.status(400).json({ success: false, message: 'Le format de datePrescription est invalide. Utilisez le format ISO 8601.' });
            }
            if (datePrescriptionParsed > new Date()) {
                return res.status(400).json({ success: false, message: 'La date de prescription ne peut pas être dans le futur.' });
            }

            const validationOptique = OrdonnanceController._validerMesuresOptiques({
                sphereOD, cylindreOD, axeOD, additionOD, ecartPupillaireOD,
                sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG
            });
            if (!validationOptique.valid) {
                return res.status(400).json({ success: false, message: validationOptique.message });
            }

            const aDesMesures = sphereOD !== undefined || sphereOG !== undefined || cylindreOD !== undefined || cylindreOG !== undefined;
            if (!aDesMesures) {
                return res.status(400).json({ success: false, message: 'Au moins une mesure optique (sphère ou cylindre) doit être fournie pour un œil.' });
            }

            const patient = await prisma.patient.findFirst({ where: { patientId, tenantId: req.user.tenantId } });
            if (!patient) {
                return res.status(404).json({ success: false, message: 'Patient non trouvé dans cette boutique.' });
            }

            const ordonnance = await prisma.ordonnance.create({
                data: {
                    tenantId: req.user.tenantId, patientId, userId: req.user.userId,
                    datePrescription: datePrescriptionParsed, nomMedecin: nomMedecin.trim(),
                    sphereOD: sphereOD !== undefined ? Number(sphereOD) : null,
                    cylindreOD: cylindreOD !== undefined ? Number(cylindreOD) : null,
                    axeOD: axeOD !== undefined ? Number(axeOD) : null,
                    additionOD: additionOD !== undefined ? Number(additionOD) : null,
                    ecartPupillaireOD: ecartPupillaireOD !== undefined ? Number(ecartPupillaireOD) : null,
                    sphereOG: sphereOG !== undefined ? Number(sphereOG) : null,
                    cylindreOG: cylindreOG !== undefined ? Number(cylindreOG) : null,
                    axeOG: axeOG !== undefined ? Number(axeOG) : null,
                    additionOG: additionOG !== undefined ? Number(additionOG) : null,
                    ecartPupillaireOG: ecartPupillaireOG !== undefined ? Number(ecartPupillaireOG) : null
                },
                select: {
                    id: true, ordonnanceId: true, datePrescription: true, nomMedecin: true,
                    sphereOD: true, cylindreOD: true, axeOD: true, additionOD: true, ecartPupillaireOD: true,
                    sphereOG: true, cylindreOG: true, axeOG: true, additionOG: true, ecartPupillaireOG: true,
                    tenantId: true,
                    patient: { select: { patientId: true, nomComplet: true } },
                    utilisateur: { select: { userId: true, nom: true, role: true } }
                }
            });

            await prisma.historiqueAction.create({
                data: {
                    tenantId: req.user.tenantId, userId: req.user.userId,
                    action: 'CREATION', modele: 'Ordonnance', entiteId: ordonnance.ordonnanceId,
                    nouvellesValeurs: { patientId, datePrescription: datePrescriptionParsed, nomMedecin: nomMedecin.trim(), sphereOD, cylindreOD, axeOD, additionOD, ecartPupillaireOD, sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG }
                }
            });

            return res.status(201).json({ success: true, message: 'Ordonnance créée avec succès.', data: ordonnance });
        } catch (error) {
            console.error('Erreur lors de la création de l\'ordonnance :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la création de l\'ordonnance.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // GET ALL — Lister les ordonnances
    // Accès : Tous les rôles (filtrés par tenant sauf SUPER_ADMIN)
    // GET /api/ordonnances
    // ============================================================
    static async getAll(req, res) {
        try {
            const { page = 1, limit = 10, patientId, nomMedecin, dateDebut, dateFin, sortBy = 'datePrescription', order = 'desc' } = req.query;
            const skip = (Number(page) - 1) * Number(limit);

            const tenantFilter = req.user.role === Role.SUPER_ADMIN ? {} : { tenantId: req.user.tenantId };
            const patientFilter = patientId ? { patientId } : {};
            const medecinFilter = nomMedecin ? { nomMedecin: { contains: nomMedecin, mode: 'insensitive' } } : {};

            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const datePrescriptionFilter = Object.keys(dateFilter).length > 0 ? { datePrescription: dateFilter } : {};

            const champsAutorises = ['datePrescription', 'nomMedecin', 'createdAt'];
            const sortField = champsAutorises.includes(sortBy) ? sortBy : 'datePrescription';
            const sortOrder = order === 'asc' ? 'asc' : 'desc';

            const whereClause = { ...tenantFilter, ...patientFilter, ...medecinFilter, ...datePrescriptionFilter };

            const [ordonnances, total] = await Promise.all([
                prisma.ordonnance.findMany({
                    where: whereClause, skip, take: Number(limit),
                    select: {
                        id: true, ordonnanceId: true, datePrescription: true, nomMedecin: true,
                        sphereOD: true, cylindreOD: true, axeOD: true, additionOD: true, ecartPupillaireOD: true,
                        sphereOG: true, cylindreOG: true, axeOG: true, additionOG: true, ecartPupillaireOG: true,
                        tenantId: true,
                        patient: { select: { patientId: true, nomComplet: true, telephone: true } },
                        utilisateur: { select: { userId: true, nom: true, role: true } },
                        _count: { select: { ventes: true, commandes: true } }
                    },
                    orderBy: { [sortField]: sortOrder }
                }),
                prisma.ordonnance.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true, data: ordonnances,
                pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
            });
        } catch (error) {
            console.error('Erreur lors de la récupération des ordonnances :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des ordonnances.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // GET BY ID — Détails complets d'une ordonnance
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/ordonnances/:ordonnanceId
    // ============================================================
    static async getById(req, res) {
        try {
            const { ordonnanceId } = req.params;

            const ordonnance = await prisma.ordonnance.findFirst({
                where: { ordonnanceId, ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId }) },
                include: {
                    patient: { select: { patientId: true, nomComplet: true, telephone: true, dateNaissance: true, nomAssurance: true, numeroAssurance: true } },
                    utilisateur: { select: { userId: true, nom: true, role: true } },
                    ventes: { select: { venteId: true, dateCreation: true, montantTotal: true, statut: true }, orderBy: { dateCreation: 'desc' } },
                    commandes: { select: { commandeId: true, statut: true, typeVerre: true, traitements: true, dateExecutionJour: true }, orderBy: { createdAt: 'desc' } }
                }
            });

            if (!ordonnance) {
                return res.status(404).json({ success: false, message: 'Ordonnance non trouvée.' });
            }

            return res.status(200).json({ success: true, data: ordonnance });
        } catch (error) {
            console.error('Erreur lors de la récupération de l\'ordonnance :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération de l\'ordonnance.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // UPDATE — Modifier une ordonnance
    // Accès : ADMIN, VENDEUR (même tenant)
    // PATCH /api/ordonnances/:ordonnanceId
    // ============================================================
    static async update(req, res) {
        try {
            const { ordonnanceId } = req.params;
            const { datePrescription, nomMedecin, sphereOD, cylindreOD, axeOD, additionOD, ecartPupillaireOD, sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG } = req.body;

            const existing = await prisma.ordonnance.findFirst({
                where: { ordonnanceId, ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId }) }
            });

            if (!existing) {
                return res.status(404).json({ success: false, message: 'Ordonnance non trouvée.' });
            }

            let datePrescriptionParsed = undefined;
            if (datePrescription !== undefined) {
                datePrescriptionParsed = new Date(datePrescription);
                if (isNaN(datePrescriptionParsed.getTime())) {
                    return res.status(400).json({ success: false, message: 'Le format de datePrescription est invalide. Utilisez le format ISO 8601.' });
                }
                if (datePrescriptionParsed > new Date()) {
                    return res.status(400).json({ success: false, message: 'La date de prescription ne peut pas être dans le futur.' });
                }
            }

            const validationOptique = OrdonnanceController._validerMesuresOptiques({ sphereOD, cylindreOD, axeOD, additionOD, ecartPupillaireOD, sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG });
            if (!validationOptique.valid) {
                return res.status(400).json({ success: false, message: validationOptique.message });
            }

            const updateData = {};
            if (datePrescriptionParsed !== undefined) updateData.datePrescription = datePrescriptionParsed;
            if (nomMedecin !== undefined) updateData.nomMedecin = nomMedecin.trim();
            if (sphereOD !== undefined) updateData.sphereOD = sphereOD !== null ? Number(sphereOD) : null;
            if (cylindreOD !== undefined) updateData.cylindreOD = cylindreOD !== null ? Number(cylindreOD) : null;
            if (axeOD !== undefined) updateData.axeOD = axeOD !== null ? Number(axeOD) : null;
            if (additionOD !== undefined) updateData.additionOD = additionOD !== null ? Number(additionOD) : null;
            if (ecartPupillaireOD !== undefined) updateData.ecartPupillaireOD = ecartPupillaireOD !== null ? Number(ecartPupillaireOD) : null;
            if (sphereOG !== undefined) updateData.sphereOG = sphereOG !== null ? Number(sphereOG) : null;
            if (cylindreOG !== undefined) updateData.cylindreOG = cylindreOG !== null ? Number(cylindreOG) : null;
            if (axeOG !== undefined) updateData.axeOG = axeOG !== null ? Number(axeOG) : null;
            if (additionOG !== undefined) updateData.additionOG = additionOG !== null ? Number(additionOG) : null;
            if (ecartPupillaireOG !== undefined) updateData.ecartPupillaireOG = ecartPupillaireOG !== null ? Number(ecartPupillaireOG) : null;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ success: false, message: 'Aucune donnée à mettre à jour.' });
            }

            const updated = await prisma.ordonnance.update({
                where: { ordonnanceId }, data: updateData,
                select: {
                    id: true, ordonnanceId: true, datePrescription: true, nomMedecin: true,
                    sphereOD: true, cylindreOD: true, axeOD: true, additionOD: true, ecartPupillaireOD: true,
                    sphereOG: true, cylindreOG: true, axeOG: true, additionOG: true, ecartPupillaireOG: true,
                    patient: { select: { patientId: true, nomComplet: true } },
                    utilisateur: { select: { userId: true, nom: true } }
                }
            });

            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId, userId: req.user.userId, action: 'MODIFICATION', modele: 'Ordonnance', entiteId: ordonnanceId,
                    anciennesValeurs: { datePrescription: existing.datePrescription, nomMedecin: existing.nomMedecin, sphereOD: existing.sphereOD, cylindreOD: existing.cylindreOD, axeOD: existing.axeOD, additionOD: existing.additionOD, ecartPupillaireOD: existing.ecartPupillaireOD, sphereOG: existing.sphereOG, cylindreOG: existing.cylindreOG, axeOG: existing.axeOG, additionOG: existing.additionOG, ecartPupillaireOG: existing.ecartPupillaireOG },
                    nouvellesValeurs: updateData
                }
            });

            return res.status(200).json({ success: true, message: 'Ordonnance mise à jour avec succès.', data: updated });
        } catch (error) {
            console.error('Erreur lors de la mise à jour de l\'ordonnance :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de l\'ordonnance.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // DELETE — Supprimer une ordonnance
    // Accès : ADMIN, SUPER_ADMIN
    // DELETE /api/ordonnances/:ordonnanceId
    // ============================================================
    static async delete(req, res) {
        try {
            const { ordonnanceId } = req.params;

            const existing = await prisma.ordonnance.findFirst({
                where: { ordonnanceId, ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId }) },
                include: { _count: { select: { ventes: true, commandes: true } } }
            });

            if (!existing) {
                return res.status(404).json({ success: false, message: 'Ordonnance non trouvée.' });
            }

            const totalDependances = existing._count.ventes + existing._count.commandes;
            if (totalDependances > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Impossible de supprimer cette ordonnance : elle est liée à des ventes ou des commandes atelier.',
                    details: { ventes: existing._count.ventes, commandes: existing._count.commandes }
                });
            }

            await prisma.ordonnance.delete({ where: { ordonnanceId } });

            await prisma.historiqueAction.create({
                data: {
                    tenantId: existing.tenantId, userId: req.user.userId, action: 'SUPPRESSION', modele: 'Ordonnance', entiteId: ordonnanceId,
                    anciennesValeurs: { datePrescription: existing.datePrescription, nomMedecin: existing.nomMedecin, patientId: existing.patientId },
                    nouvellesValeurs: null
                }
            });

            return res.status(200).json({ success: true, message: 'Ordonnance supprimée avec succès.' });
        } catch (error) {
            console.error('Erreur lors de la suppression de l\'ordonnance :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la suppression de l\'ordonnance.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // SEARCH — Recherche avancée
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/ordonnances/search
    // ============================================================
    static async search(req, res) {
        try {
            const { patientNom, nomMedecin, dateDebut, dateFin, page = 1, limit = 10 } = req.query;

            if (!patientNom && !nomMedecin && !dateDebut && !dateFin) {
                return res.status(400).json({ success: false, message: 'Au moins un critère de recherche est requis (patientNom, nomMedecin, dateDebut ou dateFin).' });
            }

            const skip = (Number(page) - 1) * Number(limit);
            const tenantFilter = req.user.role === Role.SUPER_ADMIN ? {} : { tenantId: req.user.tenantId };
            const filters = [];

            if (patientNom) filters.push({ patient: { nomComplet: { contains: patientNom, mode: 'insensitive' } } });
            if (nomMedecin) filters.push({ nomMedecin: { contains: nomMedecin, mode: 'insensitive' } });
            if (dateDebut || dateFin) {
                const rangeDate = {};
                if (dateDebut) rangeDate.gte = new Date(dateDebut);
                if (dateFin) rangeDate.lte = new Date(dateFin);
                filters.push({ datePrescription: rangeDate });
            }

            const whereClause = { ...tenantFilter, ...(filters.length > 0 ? { AND: filters } : {}) };

            const [ordonnances, total] = await Promise.all([
                prisma.ordonnance.findMany({
                    where: whereClause, skip, take: Number(limit),
                    select: {
                        id: true, ordonnanceId: true, datePrescription: true, nomMedecin: true,
                        sphereOD: true, cylindreOD: true, axeOD: true, additionOD: true,
                        sphereOG: true, cylindreOG: true, axeOG: true, additionOG: true,
                        patient: { select: { patientId: true, nomComplet: true } },
                        utilisateur: { select: { userId: true, nom: true } },
                        _count: { select: { ventes: true, commandes: true } }
                    },
                    orderBy: { datePrescription: 'desc' }
                }),
                prisma.ordonnance.count({ where: whereClause })
            ]);

            return res.status(200).json({ success: true, data: ordonnances, pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) } });
        } catch (error) {
            console.error('Erreur lors de la recherche d\'ordonnances :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la recherche.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // GET STATS — Statistiques des ordonnances de la boutique
    // Accès : ADMIN, VENDEUR
    // GET /api/ordonnances/stats/global
    // ============================================================
    static async getStatsGlobal(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;
            const tenantFilter = req.user.role === Role.SUPER_ADMIN ? {} : { tenantId: req.user.tenantId };

            const dateFilter = {};
            if (dateDebut) dateFilter.gte = new Date(dateDebut);
            if (dateFin) dateFilter.lte = new Date(dateFin);
            const datePrescriptionFilter = Object.keys(dateFilter).length > 0 ? { datePrescription: dateFilter } : {};
            const whereClause = { ...tenantFilter, ...datePrescriptionFilter };

            const [totalOrdonnances, ordonnancesAvecVentes, ordonnancesAvecCommandes, topMedecins] = await Promise.all([
                prisma.ordonnance.count({ where: whereClause }),
                prisma.ordonnance.count({ where: { ...whereClause, ventes: { some: {} } } }),
                prisma.ordonnance.count({ where: { ...whereClause, commandes: { some: {} } } }),
                prisma.ordonnance.groupBy({ by: ['nomMedecin'], where: whereClause, _count: { _all: true }, orderBy: { _count: { nomMedecin: 'desc' } }, take: 5 })
            ]);

            const topMedecinsFormates = topMedecins.map((m) => ({ nomMedecin: m.nomMedecin, nombreOrdonnances: m._count._all }));
            const tauxConversionVente = totalOrdonnances > 0 ? Number(((ordonnancesAvecVentes / totalOrdonnances) * 100).toFixed(2)) : null;

            return res.status(200).json({
                success: true,
                data: {
                    periode: { dateDebut: dateDebut || null, dateFin: dateFin || null },
                    resume: { totalOrdonnances, ordonnancesAvecVentes, ordonnancesAvecCommandes, ordonnancesSansVente: totalOrdonnances - ordonnancesAvecVentes, tauxConversionVente },
                    topMedecins: topMedecinsFormates
                }
            });
        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des statistiques des ordonnances.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    // ============================================================
    // COMPARER — Comparer deux ordonnances d'un même patient
    // Accès : Tous les rôles (isolation tenant)
    // GET /api/ordonnances/comparer?id1=xxx&id2=yyy
    // ============================================================
    static async comparer(req, res) {
        try {
            const { id1, id2 } = req.query;

            if (!id1 || !id2) return res.status(400).json({ success: false, message: 'Les paramètres id1 et id2 sont obligatoires.' });
            if (id1 === id2) return res.status(400).json({ success: false, message: 'Les deux ordonnances doivent être différentes.' });

            const tenantFilter = req.user.role !== Role.SUPER_ADMIN ? { tenantId: req.user.tenantId } : {};
            const selectFields = {
                ordonnanceId: true, datePrescription: true, nomMedecin: true,
                sphereOD: true, cylindreOD: true, axeOD: true, additionOD: true, ecartPupillaireOD: true,
                sphereOG: true, cylindreOG: true, axeOG: true, additionOG: true, ecartPupillaireOG: true,
                patientId: true, patient: { select: { patientId: true, nomComplet: true } }
            };

            const [ord1, ord2] = await Promise.all([
                prisma.ordonnance.findFirst({ where: { ordonnanceId: id1, ...tenantFilter }, select: selectFields }),
                prisma.ordonnance.findFirst({ where: { ordonnanceId: id2, ...tenantFilter }, select: selectFields })
            ]);

            if (!ord1) return res.status(404).json({ success: false, message: `Ordonnance "${id1}" non trouvée.` });
            if (!ord2) return res.status(404).json({ success: false, message: `Ordonnance "${id2}" non trouvée.` });
            if (ord1.patientId !== ord2.patientId) return res.status(400).json({ success: false, message: 'Les deux ordonnances doivent appartenir au même patient pour être comparées.' });

            const evolution = {
                oeilDroit: {
                    sphere: OrdonnanceController._calculerEvolution(ord1.sphereOD, ord2.sphereOD),
                    cylindre: OrdonnanceController._calculerEvolution(ord1.cylindreOD, ord2.cylindreOD),
                    axe: OrdonnanceController._calculerEvolution(ord1.axeOD, ord2.axeOD),
                    addition: OrdonnanceController._calculerEvolution(ord1.additionOD, ord2.additionOD),
                    ecartPupillaire: OrdonnanceController._calculerEvolution(ord1.ecartPupillaireOD, ord2.ecartPupillaireOD)
                },
                oeilGauche: {
                    sphere: OrdonnanceController._calculerEvolution(ord1.sphereOG, ord2.sphereOG),
                    cylindre: OrdonnanceController._calculerEvolution(ord1.cylindreOG, ord2.cylindreOG),
                    axe: OrdonnanceController._calculerEvolution(ord1.axeOG, ord2.axeOG),
                    addition: OrdonnanceController._calculerEvolution(ord1.additionOG, ord2.additionOG),
                    ecartPupillaire: OrdonnanceController._calculerEvolution(ord1.ecartPupillaireOG, ord2.ecartPupillaireOG)
                }
            };

            return res.status(200).json({ success: true, data: { patient: ord1.patient, ancienne: ord1, recente: ord2, evolution } });
        } catch (error) {
            console.error('Erreur lors de la comparaison :', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la comparaison des ordonnances.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }
}

export default OrdonnanceController;
