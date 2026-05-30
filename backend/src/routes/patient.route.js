import { Router } from 'express';
import PatientController from '../controllers/patient.controller.js';
import {
    authenticate,
    authorize
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Patients
 * Toutes les routes nécessitent une authentification.
 */
router.use(authenticate);

/**
 * @route   GET /api/patients/search
 * @desc    Recherche avancée de patients (multi-critères)
 * @access  Tous les rôles
 * @query   q               - Terme libre (nomComplet, téléphone, profession)
 * @query   nomAssurance    - Filtrer par assurance
 * @query   dateNaissanceMin - Borne inférieure de date de naissance (ISO 8601)
 * @query   dateNaissanceMax - Borne supérieure de date de naissance (ISO 8601)
 * @query   page            - Numéro de page (défaut : 1)
 * @query   limit           - Éléments par page (défaut : 10)
 *
 * ⚠️  Cette route doit être AVANT /:patientId pour ne pas être capturée par elle.
 */
router.get('/search', PatientController.search);

/**
 * @route   POST /api/patients
 * @desc    Créer un nouveau patient
 * @access  ADMIN, VENDEUR
 * @body    nomComplet      - Nom complet du patient (obligatoire)
 * @body    telephone       - Numéro de téléphone (optionnel)
 * @body    profession      - Profession (optionnel)
 * @body    dateNaissance   - Date de naissance ISO 8601 (optionnel)
 * @body    nomAssurance    - Nom de l'organisme d'assurance (optionnel)
 * @body    numeroAssurance - Numéro d'adhérent (optionnel, requis si nomAssurance)
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    PatientController.create
);

/**
 * @route   GET /api/patients
 * @desc    Lister les patients de la boutique courante
 * @access  Tous les rôles
 * @query   page      - Numéro de page (défaut : 1)
 * @query   limit     - Éléments par page (défaut : 10)
 * @query   search    - Recherche libre (nomComplet, téléphone, profession, assurance)
 * @query   assurance - 'true' = avec assurance | 'false' = sans assurance
 * @query   sortBy    - Champ de tri : nomComplet | createdAt | dateNaissance (défaut : createdAt)
 * @query   order     - Sens du tri : asc | desc (défaut : desc)
 */
router.get('/', PatientController.getAll);

/**
 * @route   GET /api/patients/:patientId
 * @desc    Récupérer les détails d'un patient
 * @access  Tous les rôles (isolation tenant)
 * @param   patientId - UUID du patient
 */
router.get('/:patientId', PatientController.getById);

/**
 * @route   GET /api/patients/:patientId/historique
 * @desc    Récupérer l'historique complet d'un patient (ordonnances + ventes + devis)
 * @access  Tous les rôles (isolation tenant)
 * @param   patientId - UUID du patient
 */
router.get('/:patientId/historique', PatientController.getHistorique);

/**
 * @route   GET /api/patients/:patientId/ordonnances
 * @desc    Récupérer les ordonnances d'un patient (paginées)
 * @access  Tous les rôles (isolation tenant)
 * @param   patientId - UUID du patient
 * @query   page  - Numéro de page (défaut : 1)
 * @query   limit - Éléments par page (défaut : 10)
 */
router.get('/:patientId/ordonnances', PatientController.getOrdonnances);

/**
 * @route   GET /api/patients/:patientId/stats
 * @desc    Récupérer les statistiques d'un patient
 * @access  Tous les rôles (isolation tenant)
 * @param   patientId - UUID du patient
 */
router.get('/:patientId/stats', PatientController.getStats);

/**
 * @route   PATCH /api/patients/:patientId
 * @desc    Mettre à jour les informations d'un patient
 * @access  ADMIN, VENDEUR (même tenant)
 * @param   patientId - UUID du patient
 * @body    nomComplet      - Nouveau nom (optionnel)
 * @body    telephone       - Nouveau téléphone (optionnel)
 * @body    profession      - Nouvelle profession (optionnel)
 * @body    dateNaissance   - Nouvelle date de naissance (optionnel)
 * @body    nomAssurance    - Nouveau nom d'assurance (optionnel)
 * @body    numeroAssurance - Nouveau numéro d'assurance (optionnel)
 */
router.patch(
    '/:patientId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    PatientController.update
);

/**
 * @route   DELETE /api/patients/:patientId
 * @desc    Supprimer un patient (bloqué s'il a un historique métier)
 * @access  ADMIN, SUPER_ADMIN uniquement
 * @param   patientId - UUID du patient
 */
router.delete(
    '/:patientId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    PatientController.delete
);

export default router;