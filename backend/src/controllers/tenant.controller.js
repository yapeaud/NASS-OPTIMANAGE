import pkg from '@prisma/client';
const { Role } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * @typedef {{ userId: string, tenantId: string, role: import('@prisma/client').Role, email: string }} AuthUser
 * @typedef {import('express').Request & { user?: AuthUser }} AuthenticatedRequest
 * @typedef {import('express').Response} Response
 */

/**
 * TenantController
 * Gère les opérations CRUD sur les boutiques avec isolation multi-tenant
 */
export class TenantController {

    /**
     * Créer une nouvelle boutique
     * Accès : SUPER_ADMIN uniquement
     * POST /api/tenants
     * @param {AuthenticatedRequest} req
     * @param {Response} res
     */
    static async create(req, res) {
        try {
            if (req.user?.role !== Role.SUPER_ADMIN) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé. Seuls les SUPER_ADMIN peuvent créer des boutiques.'
                });
            }

            const { nomBoutique, adresse, telephone } = req.body;

            if (!nomBoutique || !adresse || !telephone) {
                return res.status(400).json({
                    success: false,
                    message: 'Les champs nomBoutique, adresse et telephone sont obligatoires.'
                });
            }

            const tenant = await prisma.tenant.create({
                data: { nomBoutique, adresse, telephone },
                select: {
                    id: true,
                    tenantId: true,
                    nomBoutique: true,
                    adresse: true,
                    telephone: true,
                    createdAt: true
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Boutique créée avec succès.',
                data: tenant
            });

        } catch (error) {
            console.error('Erreur lors de la création du tenant:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la boutique.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Lister toutes les boutiques
     * Accès : SUPER_ADMIN uniquement
     * GET /api/tenants
     * @param {AuthenticatedRequest} req
     * @param {Response} res
     */
    static async getAll(req, res) {
        try {
            if (req.user?.role !== Role.SUPER_ADMIN) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé. Seuls les SUPER_ADMIN peuvent lister toutes les boutiques.'
                });
            }

            const { page = 1, limit = 10, search } = req.query;
            const skip = (Number(page) - 1) * Number(limit);

            const whereClause = search
                ? {
                    OR: [
                        { nomBoutique: { contains: search, mode: 'insensitive' } },
                        { adresse: { contains: search, mode: 'insensitive' } },
                        { telephone: { contains: search, mode: 'insensitive' } }
                    ]
                }
                : {};

            const [tenants, total] = await Promise.all([
                prisma.tenant.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        tenantId: true,
                        nomBoutique: true,
                        adresse: true,
                        telephone: true,
                        createdAt: true,
                        _count: {
                            select: {
                                utilisateurs: true,
                                patients: true,
                                produits: true,
                                ventes: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }),
                prisma.tenant.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: tenants,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des tenants:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des boutiques.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Récupérer les informations de la boutique courante
     * Accès : Tous les utilisateurs authentifiés
     * GET /api/tenants/current
     * @param {AuthenticatedRequest} req
     * @param {Response} res
     */
    static async getCurrent(req, res) {
        try {
            if (!req.user?.tenantId) {
                return res.status(401).json({
                    success: false,
                    message: 'Utilisateur non authentifié ou tenant non identifié.'
                });
            }

            const tenant = await prisma.tenant.findUnique({
                where: { tenantId: req.user.tenantId },
                select: {
                    id: true,
                    tenantId: true,
                    nomBoutique: true,
                    adresse: true,
                    telephone: true,
                    createdAt: true,
                    _count: {
                        select: {
                            utilisateurs: true,
                            patients: true,
                            produits: true,
                            ventes: true,
                            commandes: true
                        }
                    }
                }
            });

            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: 'Boutique non trouvée.'
                });
            }

            return res.status(200).json({
                success: true,
                data: tenant
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du tenant courant:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la boutique courante.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Récupérer les détails d'une boutique spécifique
     * Accès : SUPER_ADMIN ou utilisateur de cette boutique
     * GET /api/tenants/:tenantId
     * @param {AuthenticatedRequest} req
     * @param {Response} res
     */
    static async getById(req, res) {
        try {
            const { tenantId } = req.params;

            const isSuperAdmin = req.user?.role === Role.SUPER_ADMIN;
            const isOwnTenant = req.user?.tenantId === tenantId;

            if (!isSuperAdmin && !isOwnTenant) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé. Vous ne pouvez consulter que votre propre boutique.'
                });
            }

            const tenant = await prisma.tenant.findUnique({
                where: { tenantId },
                select: {
                    id: true,
                    tenantId: true,
                    nomBoutique: true,
                    adresse: true,
                    telephone: true,
                    createdAt: true,
                    _count: {
                        select: {
                            utilisateurs: true,
                            patients: true,
                            fournisseurs: true,
                            produits: true,
                            ventes: true,
                            commandes: true,
                            ordonnances: true,
                            devis: true,
                            retours: true,
                            historiques: true,
                            mouvements: true
                        }
                    }
                }
            });

            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: 'Boutique non trouvée.'
                });
            }

            return res.status(200).json({
                success: true,
                data: tenant
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du tenant:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la boutique.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Mettre à jour les informations d'une boutique
     * Accès : SUPER_ADMIN ou ADMIN de cette boutique
     * PATCH /api/tenants/:tenantId
     * @param {AuthenticatedRequest} req
     * @param {Response} res
     */
    static async update(req, res) {
        try {
            const { tenantId } = req.params;
            const { nomBoutique, adresse, telephone } = req.body;

            const isSuperAdmin = req.user?.role === Role.SUPER_ADMIN;
            const isOwnTenantAdmin =
                req.user?.tenantId === tenantId &&
                req.user?.role === Role.ADMIN;

            if (!isSuperAdmin && !isOwnTenantAdmin) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé. Seuls les ADMIN et SUPER_ADMIN peuvent modifier une boutique.'
                });
            }

            const existingTenant = await prisma.tenant.findUnique({
                where: { tenantId }
            });

            if (!existingTenant) {
                return res.status(404).json({
                    success: false,
                    message: 'Boutique non trouvée.'
                });
            }

            const updateData = {};
            if (nomBoutique !== undefined) updateData.nomBoutique = nomBoutique;
            if (adresse !== undefined) updateData.adresse = adresse;
            if (telephone !== undefined) updateData.telephone = telephone;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune donnée à mettre à jour.'
                });
            }

            const updatedTenant = await prisma.tenant.update({
                where: { tenantId },
                data: updateData,
                select: {
                    id: true,
                    tenantId: true,
                    nomBoutique: true,
                    adresse: true,
                    telephone: true,
                    createdAt: true
                }
            });

            await prisma.historiqueAction.create({
                data: {
                    tenantId,
                    userId: req.user?.userId,
                    action: 'MODIFICATION',
                    modele: 'Tenant',
                    entiteId: tenantId,
                    anciennesValeurs: {
                        nomBoutique: existingTenant.nomBoutique,
                        adresse: existingTenant.adresse,
                        telephone: existingTenant.telephone
                    },
                    nouvellesValeurs: updateData
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Boutique mise à jour avec succès.',
                data: updatedTenant
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour du tenant:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de la boutique.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Obtenir les statistiques d'une boutique
     * Accès : SUPER_ADMIN ou utilisateurs de cette boutique
     * GET /api/tenants/:tenantId/stats
     * @param {AuthenticatedRequest} req
     * @param {Response} res
     */
    static async getStats(req, res) {
        try {
            const { tenantId } = req.params;

            const isSuperAdmin = req.user?.role === Role.SUPER_ADMIN;
            const isOwnTenant = req.user?.tenantId === tenantId;

            if (!isSuperAdmin && !isOwnTenant) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé.'
                });
            }

            const [
                totalUtilisateurs,
                totalPatients,
                totalProduits,
                totalVentes,
                montantVentesTotal,
                commandesEnCours,
                devisEnAttente,
                retoursEnAttente
            ] = await Promise.all([
                prisma.utilisateur.count({ where: { tenantId, actif: true } }),
                prisma.patient.count({ where: { tenantId } }),
                prisma.produit.count({ where: { tenantId } }),
                prisma.vente.count({ where: { tenantId } }),
                prisma.vente.aggregate({
                    where: { tenantId },
                    _sum: { montantTotal: true }
                }),
                prisma.commandeAtelier.count({
                    where: {
                        tenantId,
                        statut: { in: ['COMMANDE_PASSEE', 'EN_COURS'] }
                    }
                }),
                prisma.devis.count({
                    where: {
                        tenantId,
                        statut: { in: ['BROUILLON', 'ENVOYE'] }
                    }
                }),
                prisma.retour.count({
                    where: {
                        tenantId,
                        statut: 'EN_ATTENTE'
                    }
                })
            ]);

            const stockData = await prisma.produit.aggregate({
                where: { tenantId },
                _sum: { quantiteEnStock: true }
            });

            return res.status(200).json({
                success: true,
                data: {
                    utilisateurs: { total: totalUtilisateurs },
                    patients: { total: totalPatients },
                    produits: {
                        total: totalProduits,
                        stockTotal: stockData._sum.quantiteEnStock ?? 0
                    },
                    ventes: {
                        total: totalVentes,
                        montantTotal: montantVentesTotal._sum.montantTotal ?? 0
                    },
                    commandesAtelier: { enCours: commandesEnCours },
                    devis: { enAttente: devisEnAttente },
                    retours: { enAttente: retoursEnAttente }
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * IMPORTANT : La suppression de tenant n'est PAS implémentée.
     * C'est une opération trop dangereuse (cascade sur toutes les données).
     * Si nécessaire, implémenter plutôt un système de soft-delete (champ actif).
     */
}

export default TenantController;
