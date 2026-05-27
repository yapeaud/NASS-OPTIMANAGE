import pkg from '@prisma/client';
import bcrypt from 'bcrypt';
const { Role } = pkg;
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

/**
 * UtilisateurController
 * Gère les opérations CRUD sur les utilisateurs avec isolation multi-tenant
 */
class UtilisateurController {

    /**
     * Créer un nouvel utilisateur
     * Accès : SUPER_ADMIN ou ADMIN de la boutique
     * POST /api/utilisateurs
     */
    static async create(req, res) {
        try {
            const { nom, email, motDePasse, role, tenantId } = req.body;

            // Validation des champs requis
            if (!nom || !email || !motDePasse || !role) {
                return res.status(400).json({
                    success: false,
                    message: 'Les champs nom, email, motDePasse et role sont obligatoires.'
                });
            }

            // Validation du rôle
            const rolesValides = Object.values(Role);
            if (!rolesValides.includes(role)) {
                return res.status(400).json({
                    success: false,
                    message: `Rôle invalide. Rôles autorisés : ${rolesValides.join(', ')}`
                });
            }

            // Détermination du tenantId
            let targetTenantId = tenantId;

            // Si SUPER_ADMIN, il peut créer un utilisateur dans n'importe quelle boutique
            if (req.user.role === Role.SUPER_ADMIN) {
                if (!tenantId) {
                    return res.status(400).json({
                        success: false,
                        message: 'Le tenantId est obligatoire pour un SUPER_ADMIN.'
                    });
                }
                targetTenantId = tenantId;
            } else if (req.user.role === Role.ADMIN) {
                // Un ADMIN ne peut créer que dans SA boutique
                targetTenantId = req.user.tenantId;

                // Un ADMIN ne peut pas créer de SUPER_ADMIN
                if (role === Role.SUPER_ADMIN) {
                    return res.status(403).json({
                        success: false,
                        message: 'Un ADMIN ne peut pas créer de SUPER_ADMIN.'
                    });
                }
            } else {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé. Seuls les ADMIN et SUPER_ADMIN peuvent créer des utilisateurs.'
                });
            }

            // Vérification que le tenant existe
            const tenantExists = await prisma.tenant.findUnique({
                where: { tenantId: targetTenantId }
            });

            if (!tenantExists) {
                return res.status(404).json({
                    success: false,
                    message: 'Boutique non trouvée.'
                });
            }

            // Vérification de l'unicité de l'email dans cette boutique
            const existingUser = await prisma.utilisateur.findFirst({
                where: {
                    email,
                    tenantId: targetTenantId
                }
            });

            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'Un utilisateur avec cet email existe déjà dans cette boutique.'
                });
            }

            // Hashage du mot de passe
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
            const hashedPassword = await bcrypt.hash(motDePasse, saltRounds);

            // Création de l'utilisateur
            const utilisateur = await prisma.utilisateur.create({
                data: {
                    nom,
                    email,
                    motDePasse: hashedPassword,
                    role,
                    tenantId: targetTenantId,
                    actif: true
                },
                select: {
                    id: true,
                    userId: true,
                    nom: true,
                    email: true,
                    role: true,
                    actif: true,
                    createdAt: true,
                    tenantId: true,
                    tenant: {
                        select: {
                            nomBoutique: true
                        }
                    }
                }
            });

            // Enregistrement dans l'historique
            await prisma.historiqueAction.create({
                data: {
                    tenantId: targetTenantId,
                    userId: req.user.userId,
                    action: 'CREATION',
                    modele: 'Utilisateur',
                    entiteId: utilisateur.userId,
                    nouvellesValeurs: {
                        nom: utilisateur.nom,
                        email: utilisateur.email,
                        role: utilisateur.role
                    }
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Utilisateur créé avec succès.',
                data: utilisateur
            });

        } catch (error) {
            console.error('Erreur lors de la création de l\'utilisateur:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de l\'utilisateur.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Lister tous les utilisateurs
     * Accès : SUPER_ADMIN (tous) ou ADMIN/VENDEUR/MONTEUR (leur boutique)
     * GET /api/utilisateurs
     */
    static async getAll(req, res) {
        try {
            const { page = 1, limit = 10, search, role, actif } = req.query;
            const skip = (Number(page) - 1) * Number(limit);

            // Construction du filtre tenant
            const tenantFilter = req.user.role === Role.SUPER_ADMIN
                ? {}
                : { tenantId: req.user.tenantId };

            // Construction de la clause where pour la recherche
            const whereClause = {
                ...tenantFilter,
                ...(search && {
                    OR: [
                        { nom: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } }
                    ]
                }),
                ...(role && { role }),
                ...(actif !== undefined && { actif: actif === 'true' })
            };

            // Récupération des utilisateurs avec pagination
            const [utilisateurs, total] = await Promise.all([
                prisma.utilisateur.findMany({
                    where: whereClause,
                    skip,
                    take: Number(limit),
                    select: {
                        id: true,
                        userId: true,
                        nom: true,
                        email: true,
                        role: true,
                        actif: true,
                        createdAt: true,
                        tenantId: true,
                        tenant: {
                            select: {
                                nomBoutique: true,
                                adresse: true
                            }
                        },
                        _count: {
                            select: {
                                ventes: true,
                                devis: true,
                                ordonnances: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }),
                prisma.utilisateur.count({ where: whereClause })
            ]);

            return res.status(200).json({
                success: true,
                data: utilisateurs,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des utilisateurs:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des utilisateurs.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Récupérer les détails d'un utilisateur
     * Accès : SUPER_ADMIN ou utilisateurs de la même boutique
     * GET /api/utilisateurs/:userId
     */
    static async getById(req, res) {
        try {
            const { userId } = req.params;

            // Construction du filtre tenant
            const whereClause = {
                userId,
                ...(req.user.role !== Role.SUPER_ADMIN && { tenantId: req.user.tenantId })
            };

            const utilisateur = await prisma.utilisateur.findFirst({
                where: whereClause,
                select: {
                    id: true,
                    userId: true,
                    nom: true,
                    email: true,
                    role: true,
                    actif: true,
                    createdAt: true,
                    tenantId: true,
                    tenant: {
                        select: {
                            nomBoutique: true,
                            adresse: true,
                            telephone: true
                        }
                    },
                    _count: {
                        select: {
                            ventes: true,
                            devis: true,
                            ordonnances: true,
                            retours: true,
                            paiements: true,
                            historiques: true,
                            mouvements: true
                        }
                    }
                }
            });

            if (!utilisateur) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            return res.status(200).json({
                success: true,
                data: utilisateur
            });

        } catch (error) {
            console.error('Erreur lors de la récupération de l\'utilisateur:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de l\'utilisateur.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Récupérer le profil de l'utilisateur connecté
     * Accès : Tous les utilisateurs authentifiés
     * GET /api/utilisateurs/me
     */
    static async getProfile(req, res) {
        try {
            const utilisateur = await prisma.utilisateur.findUnique({
                where: { userId: req.user.userId },
                select: {
                    id: true,
                    userId: true,
                    nom: true,
                    email: true,
                    role: true,
                    actif: true,
                    createdAt: true,
                    tenantId: true,
                    tenant: {
                        select: {
                            nomBoutique: true,
                            adresse: true,
                            telephone: true
                        }
                    },
                    _count: {
                        select: {
                            ventes: true,
                            devis: true,
                            ordonnances: true
                        }
                    }
                }
            });

            if (!utilisateur) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            return res.status(200).json({
                success: true,
                data: utilisateur
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du profil:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du profil.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Mettre à jour un utilisateur
     * Accès : SUPER_ADMIN, ADMIN, ou l'utilisateur lui-même (limité)
     * PATCH /api/utilisateurs/:userId
     */
    static async update(req, res) {
        try {
            const { userId } = req.params;
            const { nom, email, role, actif, motDePasse } = req.body;

            // Vérification que l'utilisateur existe
            const existingUser = await prisma.utilisateur.findUnique({
                where: { userId }
            });

            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            // Vérification des droits d'accès
            const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
            const isAdmin = req.user.role === Role.ADMIN && req.user.tenantId === existingUser.tenantId;
            const isSelf = req.user.userId === userId;

            if (!isSuperAdmin && !isAdmin && !isSelf) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé.'
                });
            }

            // Restrictions pour un utilisateur qui se modifie lui-même
            if (isSelf && !isSuperAdmin && !isAdmin) {
                // Un utilisateur normal ne peut modifier que son nom et mot de passe
                if (role || actif !== undefined) {
                    return res.status(403).json({
                        success: false,
                        message: 'Vous ne pouvez modifier que votre nom et votre mot de passe.'
                    });
                }
            }

            // Un ADMIN ne peut pas modifier un SUPER_ADMIN
            if (isAdmin && existingUser.role === Role.SUPER_ADMIN) {
                return res.status(403).json({
                    success: false,
                    message: 'Un ADMIN ne peut pas modifier un SUPER_ADMIN.'
                });
            }

            // Un ADMIN ne peut pas promouvoir quelqu'un en SUPER_ADMIN
            if (isAdmin && role === Role.SUPER_ADMIN) {
                return res.status(403).json({
                    success: false,
                    message: 'Un ADMIN ne peut pas créer de SUPER_ADMIN.'
                });
            }

            // Vérification de l'unicité de l'email si modifié
            if (email && email !== existingUser.email) {
                const emailExists = await prisma.utilisateur.findFirst({
                    where: {
                        email,
                        tenantId: existingUser.tenantId,
                        userId: { not: userId }
                    }
                });

                if (emailExists) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un utilisateur avec cet email existe déjà dans cette boutique.'
                    });
                }
            }

            // Préparation des données à mettre à jour
            const updateData = {};
            if (nom !== undefined) updateData.nom = nom;
            if (email !== undefined) updateData.email = email;
            if (role !== undefined && (isSuperAdmin || isAdmin)) updateData.role = role;
            if (actif !== undefined && (isSuperAdmin || isAdmin)) updateData.actif = actif;

            // Hashage du nouveau mot de passe si fourni
            if (motDePasse) {
                const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
                updateData.motDePasse = await bcrypt.hash(motDePasse, saltRounds);
            }

            // Vérification qu'au moins un champ est fourni
            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune donnée à mettre à jour.'
                });
            }

            // Mise à jour de l'utilisateur
            const updatedUser = await prisma.utilisateur.update({
                where: { userId },
                data: updateData,
                select: {
                    id: true,
                    userId: true,
                    nom: true,
                    email: true,
                    role: true,
                    actif: true,
                    createdAt: true,
                    tenantId: true,
                    tenant: {
                        select: {
                            nomBoutique: true
                        }
                    }
                }
            });

            // Enregistrement dans l'historique
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existingUser.tenantId,
                    userId: req.user.userId,
                    action: 'MODIFICATION',
                    modele: 'Utilisateur',
                    entiteId: userId,
                    anciennesValeurs: {
                        nom: existingUser.nom,
                        email: existingUser.email,
                        role: existingUser.role,
                        actif: existingUser.actif
                    },
                    nouvellesValeurs: updateData
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Utilisateur mis à jour avec succès.',
                data: updatedUser
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de l\'utilisateur.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Désactiver un utilisateur (soft delete)
     * Accès : SUPER_ADMIN ou ADMIN de la boutique
     * DELETE /api/utilisateurs/:userId
     */
    static async deactivate(req, res) {
        try {
            const { userId } = req.params;

            // Vérification que l'utilisateur existe
            const existingUser = await prisma.utilisateur.findUnique({
                where: { userId }
            });

            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            // Vérification des droits d'accès
            const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
            const isAdmin = req.user.role === Role.ADMIN && req.user.tenantId === existingUser.tenantId;

            if (!isSuperAdmin && !isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé. Seuls les ADMIN et SUPER_ADMIN peuvent désactiver des utilisateurs.'
                });
            }

            // Un utilisateur ne peut pas se désactiver lui-même
            if (req.user.userId === userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Vous ne pouvez pas désactiver votre propre compte.'
                });
            }

            // Un ADMIN ne peut pas désactiver un SUPER_ADMIN
            if (isAdmin && existingUser.role === Role.SUPER_ADMIN) {
                return res.status(403).json({
                    success: false,
                    message: 'Un ADMIN ne peut pas désactiver un SUPER_ADMIN.'
                });
            }

            // Désactivation de l'utilisateur (soft delete)
            const deactivatedUser = await prisma.utilisateur.update({
                where: { userId },
                data: { actif: false },
                select: {
                    id: true,
                    userId: true,
                    nom: true,
                    email: true,
                    role: true,
                    actif: true
                }
            });

            // Enregistrement dans l'historique
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existingUser.tenantId,
                    userId: req.user.userId,
                    action: 'CHANGEMENT_STATUT',
                    modele: 'Utilisateur',
                    entiteId: userId,
                    anciennesValeurs: { actif: true },
                    nouvellesValeurs: { actif: false }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Utilisateur désactivé avec succès.',
                data: deactivatedUser
            });

        } catch (error) {
            console.error('Erreur lors de la désactivation de l\'utilisateur:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la désactivation de l\'utilisateur.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Réactiver un utilisateur
     * Accès : SUPER_ADMIN ou ADMIN de la boutique
     * PATCH /api/utilisateurs/:userId/reactivate
     */
    static async reactivate(req, res) {
        try {
            const { userId } = req.params;

            // Vérification que l'utilisateur existe
            const existingUser = await prisma.utilisateur.findUnique({
                where: { userId }
            });

            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            // Vérification des droits d'accès
            const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
            const isAdmin = req.user.role === Role.ADMIN && req.user.tenantId === existingUser.tenantId;

            if (!isSuperAdmin && !isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé.'
                });
            }

            // Vérifier que l'utilisateur est bien désactivé
            if (existingUser.actif) {
                return res.status(400).json({
                    success: false,
                    message: 'L\'utilisateur est déjà actif.'
                });
            }

            // Réactivation de l'utilisateur
            const reactivatedUser = await prisma.utilisateur.update({
                where: { userId },
                data: { actif: true },
                select: {
                    id: true,
                    userId: true,
                    nom: true,
                    email: true,
                    role: true,
                    actif: true
                }
            });

            // Enregistrement dans l'historique
            await prisma.historiqueAction.create({
                data: {
                    tenantId: existingUser.tenantId,
                    userId: req.user.userId,
                    action: 'CHANGEMENT_STATUT',
                    modele: 'Utilisateur',
                    entiteId: userId,
                    anciennesValeurs: { actif: false },
                    nouvellesValeurs: { actif: true }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Utilisateur réactivé avec succès.',
                data: reactivatedUser
            });

        } catch (error) {
            console.error('Erreur lors de la réactivation de l\'utilisateur:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la réactivation de l\'utilisateur.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Authentification (Login)
     * Accès : Public
     * POST /api/utilisateurs/login
     */
    static async login(req, res) {
        try {
            const { email, motDePasse } = req.body;

            // Validation des champs requis
            if (!email || !motDePasse) {
                return res.status(400).json({
                    success: false,
                    message: 'Email et mot de passe requis.'
                });
            }

            // Recherche de l'utilisateur par email
            const utilisateur = await prisma.utilisateur.findFirst({
                where: { email },
                include: {
                    tenant: {
                        select: {
                            nomBoutique: true,
                            adresse: true
                        }
                    }
                }
            });

            if (!utilisateur) {
                return res.status(401).json({
                    success: false,
                    message: 'Email ou mot de passe incorrect.'
                });
            }

            // Vérification que le compte est actif
            if (!utilisateur.actif) {
                return res.status(403).json({
                    success: false,
                    message: 'Votre compte est désactivé. Contactez un administrateur.'
                });
            }

            // Vérification du mot de passe
            const passwordMatch = await bcrypt.compare(motDePasse, utilisateur.motDePasse);

            if (!passwordMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Email ou mot de passe incorrect.'
                });
            }

            // Génération du token JWT
            const token = jwt.sign(
                {
                    userId: utilisateur.userId,
                    tenantId: utilisateur.tenantId,
                    role: utilisateur.role,
                    email: utilisateur.email
                },
                process.env.JWT_SECRET || 'your-secret-key',
                {
                    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
                }
            );

            // Enregistrement de la connexion dans l'historique
            await prisma.historiqueAction.create({
                data: {
                    tenantId: utilisateur.tenantId,
                    userId: utilisateur.userId,
                    action: 'CONNEXION',
                    modele: 'Utilisateur',
                    entiteId: utilisateur.userId,
                    nouvellesValeurs: {
                        timestamp: new Date(),
                        ip: req.ip
                    }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Connexion réussie.',
                data: {
                    token,
                    utilisateur: {
                        userId: utilisateur.userId,
                        nom: utilisateur.nom,
                        email: utilisateur.email,
                        role: utilisateur.role,
                        tenantId: utilisateur.tenantId,
                        tenant: utilisateur.tenant
                    }
                }
            });

        } catch (error) {
            console.error('Erreur lors de l\'authentification:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'authentification.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Changer son mot de passe
     * Accès : Utilisateur authentifié
     * POST /api/utilisateurs/change-password
     */
    static async changePassword(req, res) {
        try {
            const { ancienMotDePasse, nouveauMotDePasse } = req.body;

            // Validation des champs requis
            if (!ancienMotDePasse || !nouveauMotDePasse) {
                return res.status(400).json({
                    success: false,
                    message: 'L\'ancien et le nouveau mot de passe sont requis.'
                });
            }

            // Validation de la complexité du nouveau mot de passe
            if (nouveauMotDePasse.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.'
                });
            }

            // Récupération de l'utilisateur
            const utilisateur = await prisma.utilisateur.findUnique({
                where: { userId: req.user.userId }
            });

            if (!utilisateur) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            // Vérification de l'ancien mot de passe
            const passwordMatch = await bcrypt.compare(ancienMotDePasse, utilisateur.motDePasse);

            if (!passwordMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'L\'ancien mot de passe est incorrect.'
                });
            }

            // Hashage du nouveau mot de passe
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
            const hashedPassword = await bcrypt.hash(nouveauMotDePasse, saltRounds);

            // Mise à jour du mot de passe
            await prisma.utilisateur.update({
                where: { userId: req.user.userId },
                data: { motDePasse: hashedPassword }
            });

            // Enregistrement dans l'historique
            await prisma.historiqueAction.create({
                data: {
                    tenantId: utilisateur.tenantId,
                    userId: utilisateur.userId,
                    action: 'MODIFICATION',
                    modele: 'Utilisateur',
                    entiteId: utilisateur.userId,
                    nouvellesValeurs: {
                        action: 'Changement de mot de passe',
                        timestamp: new Date()
                    }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Mot de passe changé avec succès.'
            });

        } catch (error) {
            console.error('Erreur lors du changement de mot de passe:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du changement de mot de passe.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Obtenir les statistiques d'activité d'un utilisateur
     * Accès : SUPER_ADMIN, ADMIN, ou l'utilisateur lui-même
     * GET /api/utilisateurs/:userId/stats
     */
    static async getStats(req, res) {
        try {
            const { userId } = req.params;

            // Vérification que l'utilisateur existe
            const existingUser = await prisma.utilisateur.findUnique({
                where: { userId }
            });

            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé.'
                });
            }

            // Vérification des droits d'accès
            const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
            const isAdmin = req.user.role === Role.ADMIN && req.user.tenantId === existingUser.tenantId;
            const isSelf = req.user.userId === userId;

            if (!isSuperAdmin && !isAdmin && !isSelf) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès refusé.'
                });
            }

            // Récupération des statistiques
            const [
                totalVentes,
                montantVentes,
                totalDevis,
                totalOrdonnances,
                totalRetours,
                dernieresVentes
            ] = await Promise.all([
                prisma.vente.count({ where: { userId } }),
                prisma.vente.aggregate({
                    where: { userId },
                    _sum: { montantTotal: true }
                }),
                prisma.devis.count({ where: { userId } }),
                prisma.ordonnance.count({ where: { userId } }),
                prisma.retour.count({ where: { userId } }),
                prisma.vente.findMany({
                    where: { userId },
                    take: 5,
                    orderBy: { dateCreation: 'desc' },
                    select: {
                        venteId: true,
                        dateCreation: true,
                        montantTotal: true,
                        statut: true,
                        patient: {
                            select: {
                                nomComplet: true
                            }
                        }
                    }
                })
            ]);

            return res.status(200).json({
                success: true,
                data: {
                    ventes: {
                        total: totalVentes,
                        montantTotal: montantVentes._sum.montantTotal || 0,
                        dernieres: dernieresVentes
                    },
                    devis: {
                        total: totalDevis
                    },
                    ordonnances: {
                        total: totalOrdonnances
                    },
                    retours: {
                        total: totalRetours
                    }
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
}

export default UtilisateurController;
