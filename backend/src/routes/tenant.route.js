import { Router } from 'express';
import TenantController from '../controllers/tenant.controller.js';
import {
    authenticate,
    authorize,
    verifyTenantOwnership
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Tenants (Boutiques)
 * Toutes les routes nécessitent une authentification
 */

// Appliquer l'authentification à toutes les routes
router.use(authenticate);

/**
 * @route   POST /api/tenants
 * @desc    Créer une nouvelle boutique
 * @access  SUPER_ADMIN uniquement
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN),
    TenantController.create
);

/**
 * @route   GET /api/tenants
 * @desc    Lister toutes les boutiques (avec pagination et recherche)
 * @access  SUPER_ADMIN uniquement
 * @query   page - Numéro de page (défaut: 1)
 * @query   limit - Nombre d'éléments par page (défaut: 10)
 * @query   search - Terme de recherche (nom, adresse, téléphone)
 */
router.get(
    '/',
    authorize(Role.SUPER_ADMIN),
    TenantController.getAll
);

/**
 * @route   GET /api/tenants/current
 * @desc    Récupérer les informations de la boutique courante
 * @access  Tous les utilisateurs authentifiés
 */
router.get(
    '/current',
    TenantController.getCurrent
);

/**
 * @route   GET /api/tenants/:tenantId
 * @desc    Récupérer les détails d'une boutique
 * @access  SUPER_ADMIN ou utilisateurs de cette boutique
 * @param   tenantId - UUID de la boutique
 */
router.get(
    '/:tenantId',
    verifyTenantOwnership('tenantId'),
    TenantController.getById
);

/**
 * @route   GET /api/tenants/:tenantId/stats
 * @desc    Récupérer les statistiques d'une boutique
 * @access  SUPER_ADMIN ou utilisateurs de cette boutique
 * @param   tenantId - UUID de la boutique
 */
router.get(
    '/:tenantId/stats',
    verifyTenantOwnership('tenantId'),
    TenantController.getStats
);

/**
 * @route   PATCH /api/tenants/:tenantId
 * @desc    Mettre à jour les informations d'une boutique
 * @access  SUPER_ADMIN ou ADMIN de cette boutique
 * @param   tenantId - UUID de la boutique
 * @body    nomBoutique - Nouveau nom (optionnel)
 * @body    adresse - Nouvelle adresse (optionnel)
 * @body    telephone - Nouveau téléphone (optionnel)
 */
router.patch(
    '/:tenantId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    verifyTenantOwnership('tenantId'),
    TenantController.update
);

/**
 * NOTE IMPORTANTE : 
 * La route DELETE n'est volontairement PAS implémentée.
 * La suppression d'un tenant entraînerait la suppression en cascade
 * de TOUTES les données de la boutique (utilisateurs, ventes, patients, etc.).
 * 
 * Si une fonctionnalité de désactivation est nécessaire, 
 * implémenter plutôt un champ "actif" dans le modèle Tenant.
 */

export default router;