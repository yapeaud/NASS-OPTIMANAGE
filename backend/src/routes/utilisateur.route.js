import { Router } from 'express';
import UtilisateurController from '../controllers/utilisateur.controller.js';

import {
    authenticate,
    authorize
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';

const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Utilisateurs
 */

/**
 * @route   POST /api/utilisateurs/login
 * @desc    Authentification (Login)
 * @access  Public
 */
router.post('/login', UtilisateurController.login);

// Appliquer l'authentification à toutes les routes suivantes
router.use(authenticate);

/**
 * @route   GET /api/utilisateurs/me
 * @desc    Récupérer le profil de l'utilisateur connecté
 * @access  Tous les utilisateurs authentifiés
 */
router.get('/me', UtilisateurController.getProfile);

/**
 * @route   POST /api/utilisateurs/change-password
 * @desc    Changer son mot de passe
 * @access  Tous les utilisateurs authentifiés
 */
router.post('/change-password', UtilisateurController.changePassword);

/**
 * @route   POST /api/utilisateurs
 * @desc    Créer un nouvel utilisateur
 * @access  SUPER_ADMIN ou ADMIN
 * @body    nom - Nom complet
 * @body    email - Adresse email
 * @body    motDePasse - Mot de passe
 * @body    role - Rôle (SUPER_ADMIN, ADMIN, VENDEUR, MONTEUR)
 * @body    tenantId - ID de la boutique (obligatoire pour SUPER_ADMIN)
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    UtilisateurController.create
);

/**
 * @route   GET /api/utilisateurs
 * @desc    Lister tous les utilisateurs
 * @access  Tous les utilisateurs authentifiés
 * @query   page - Numéro de page (défaut: 1)
 * @query   limit - Nombre d'éléments par page (défaut: 10)
 * @query   search - Terme de recherche (nom, email)
 * @query   role - Filtrer par rôle
 * @query   actif - Filtrer par statut actif (true/false)
 */
router.get('/', UtilisateurController.getAll);

/**
 * @route   GET /api/utilisateurs/:userId
 * @desc    Récupérer les détails d'un utilisateur
 * @access  SUPER_ADMIN ou utilisateurs de la même boutique
 * @param   userId - UUID de l'utilisateur
 */
router.get('/:userId', UtilisateurController.getById);

/**
 * @route   GET /api/utilisateurs/:userId/stats
 * @desc    Récupérer les statistiques d'activité d'un utilisateur
 * @access  SUPER_ADMIN, ADMIN, ou l'utilisateur lui-même
 * @param   userId - UUID de l'utilisateur
 */
router.get('/:userId/stats', UtilisateurController.getStats);

/**
 * @route   PATCH /api/utilisateurs/:userId
 * @desc    Mettre à jour un utilisateur
 * @access  SUPER_ADMIN, ADMIN, ou l'utilisateur lui-même (limité)
 * @param   userId - UUID de l'utilisateur
 * @body    nom - Nouveau nom (optionnel)
 * @body    email - Nouvel email (optionnel)
 * @body    role - Nouveau rôle (optionnel, ADMIN/SUPER_ADMIN seulement)
 * @body    actif - Nouveau statut actif (optionnel, ADMIN/SUPER_ADMIN seulement)
 * @body    motDePasse - Nouveau mot de passe (optionnel)
 */
router.patch('/:userId', UtilisateurController.update);

/**
 * @route   PATCH /api/utilisateurs/:userId/reactivate
 * @desc    Réactiver un utilisateur désactivé
 * @access  SUPER_ADMIN ou ADMIN
 * @param   userId - UUID de l'utilisateur
 */
router.patch(
    '/:userId/reactivate',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    UtilisateurController.reactivate
);

/**
 * @route   DELETE /api/utilisateurs/:userId
 * @desc    Désactiver un utilisateur (soft delete)
 * @access  SUPER_ADMIN ou ADMIN
 * @param   userId - UUID de l'utilisateur
 */
router.delete(
    '/:userId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    UtilisateurController.deactivate
);

export default router;
