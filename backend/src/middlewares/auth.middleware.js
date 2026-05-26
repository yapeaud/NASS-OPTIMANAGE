import jwt from 'jsonwebtoken';
import pkg from '@prisma/client';
const { Role } = pkg;
import { prisma } from '../lib/prisma.js';

/**
 * @typedef {{ userId: string, tenantId: string, role: import('@prisma/client').Role, email: string }} JwtPayload
 * @typedef {import('express').Request & { user?: JwtPayload }} AuthenticatedRequest
 */

/**
 * Middleware d'authentification JWT
 * Vérifie le token et attache les informations utilisateur à req.user
 * @param {AuthenticatedRequest} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification manquant.'
            });
        }

        const token = authHeader.substring(7); // Supprime "Bearer "

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

        const utilisateur = await prisma.utilisateur.findUnique({
            where: { userId: decoded.userId },
            select: {
                userId: true,
                tenantId: true,
                role: true,
                email: true,
                actif: true
            }
        });

        if (!utilisateur) {
            return res.status(401).json({
                success: false,
                message: 'Utilisateur non trouvé.'
            });
        }

        if (!utilisateur.actif) {
            return res.status(403).json({
                success: false,
                message: 'Compte utilisateur désactivé.'
            });
        }

        req.user = {
            userId: utilisateur.userId,
            tenantId: utilisateur.tenantId,
            role: utilisateur.role,
            email: utilisateur.email
        };

        next();

    } catch (error) {
        // TokenExpiredError hérite de JsonWebTokenError — vérifier dans cet ordre
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({
                success: false,
                message: 'Token expiré.'
            });
        }

        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                message: 'Token invalide.'
            });
        }

        console.error('Erreur d\'authentification:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'authentification.'
        });
    }
};

/**
 * Middleware de vérification des rôles
 * @param {...import('@prisma/client').Role} allowedRoles - Rôles autorisés
 */
export const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Utilisateur non authentifié.'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé. Rôle insuffisant.'
            });
        }

        next();
    };
};

/**
 * Middleware d'isolation multi-tenant
 * Exception : les SUPER_ADMIN peuvent accéder à tous les tenants
 * @param {AuthenticatedRequest} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const tenantIsolation = (req, res, next) => {
    if (req.user?.role === Role.SUPER_ADMIN) {
        return next();
    }

    if (!req.user?.tenantId) {
        return res.status(403).json({
            success: false,
            message: 'Isolation tenant : tenantId manquant.'
        });
    }

    next();
};

/**
 * Middleware pour injecter automatiquement le tenantId dans les requêtes
 * Utile pour les opérations de création/modification
 * @param {AuthenticatedRequest} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const injectTenantId = (req, res, next) => {
    if (req.user?.role !== Role.SUPER_ADMIN && req.user?.tenantId) {
        if (req.body && typeof req.body === 'object') {
            req.body.tenantId = req.user.tenantId;
        }

        if (req.query && typeof req.query === 'object') {
            req.query.tenantId = req.user.tenantId;
        }
    }

    next();
};

/**
 * Middleware de vérification d'appartenance au tenant
 * @param {string} paramName - Nom du paramètre contenant le tenantId
 */
export const verifyTenantOwnership = (paramName = 'tenantId') => {
    return (req, res, next) => {
        if (req.user?.role === Role.SUPER_ADMIN) {
            return next();
        }

        const resourceTenantId = req.params[paramName] || req.body[paramName];

        if (!resourceTenantId) {
            return res.status(400).json({
                success: false,
                message: `Le paramètre ${paramName} est requis.`
            });
        }

        if (resourceTenantId !== req.user?.tenantId) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé. Cette ressource n\'appartient pas à votre boutique.'
            });
        }

        next();
    };
};

/**
 * Génère un token JWT signé pour un utilisateur
 * @param {JwtPayload} payload
 * @returns {string}
 */
export const generateToken = (payload) => {
    return jwt.sign(
        payload,
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
};

/**
 * Retourne le filtre tenantId à injecter dans les requêtes Prisma
 * Retourne {} pour les SUPER_ADMIN (pas de restriction)
 * @param {AuthenticatedRequest} req
 * @returns {{ tenantId?: string }}
 */
export const getTenantFilter = (req) => {
    if (req.user?.role === Role.SUPER_ADMIN) {
        return {};
    }
    return { tenantId: req.user?.tenantId };
};

export default {
    authenticate,
    authorize,
    tenantIsolation,
    injectTenantId,
    verifyTenantOwnership,
    generateToken,
    getTenantFilter
};
