import { Router } from 'express';
import OrdonnanceController from '../controllers/ordonnance.controller.js';
import {
    authenticate,
    authorize
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Ordonnances
 * Toutes les routes nécessitent une authentification.
 */
router.use(authenticate);

// ================================================================
// Routes statiques — déclarées AVANT /:ordonnanceId
// ================================================================

/**
 * @route   GET /api/ordonnances/search
 * @desc    Recherche avancée d'ordonnances
 * @access  Tous les rôles
 * @query   patientNom  - Nom du patient (recherche partielle)
 * @query   nomMedecin  - Nom du médecin prescripteur (recherche partielle)
 * @query   dateDebut   - Borne inférieure de prescription (ISO 8601)
 * @query   dateFin     - Borne supérieure de prescription (ISO 8601)
 * @query   page, limit - Pagination
 */
router.get('/search', OrdonnanceController.search);

/**
 * @route   GET /api/ordonnances/stats/global
 * @desc    Statistiques des ordonnances de la boutique
 *          (totaux, taux de conversion en vente, top médecins)
 * @access  ADMIN, VENDEUR
 * @query   dateDebut - Borne inférieure (optionnel)
 * @query   dateFin   - Borne supérieure (optionnel)
 */
router.get(
    '/stats/global',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    OrdonnanceController.getStatsGlobal
);

/**
 * @route   GET /api/ordonnances/comparer
 * @desc    Comparer deux ordonnances d'un même patient
 *          Calcule l'évolution des mesures optiques entre les deux.
 * @access  Tous les rôles (isolation tenant)
 * @query   id1 - UUID de la première ordonnance (obligatoire)
 * @query   id2 - UUID de la deuxième ordonnance (obligatoire)
 */
router.get('/comparer', OrdonnanceController.comparer);

// ================================================================
// Routes de création et listage
// ================================================================

/**
 * @route   POST /api/ordonnances
 * @desc    Créer une nouvelle ordonnance
 * @access  ADMIN, VENDEUR
 * @body    patientId         - UUID du patient (obligatoire)
 * @body    datePrescription  - Date de prescription ISO 8601 (obligatoire, passée)
 * @body    nomMedecin        - Nom de l'ophtalmologue (obligatoire)
 * @body    sphereOD          - Sphère œil droit (-30 à +30 dioptries)
 * @body    cylindreOD        - Cylindre œil droit (-10 à +10 dioptries)
 * @body    axeOD             - Axe œil droit (0-180 degrés)
 * @body    additionOD        - Addition œil droit (≥ 0)
 * @body    ecartPupillaireOD - Écart pupillaire OD (20-45 mm)
 * @body    sphereOG, cylindreOG, axeOG, additionOG, ecartPupillaireOG - Idem pour OG
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    OrdonnanceController.create
);

/**
 * @route   GET /api/ordonnances
 * @desc    Lister les ordonnances de la boutique courante
 * @access  Tous les rôles
 * @query   page       - Numéro de page (défaut : 1)
 * @query   limit      - Éléments par page (défaut : 10)
 * @query   patientId  - Filtrer par patient
 * @query   nomMedecin - Filtrer par médecin
 * @query   dateDebut  - Borne inférieure de prescription
 * @query   dateFin    - Borne supérieure de prescription
 * @query   sortBy     - datePrescription | nomMedecin | createdAt (défaut : datePrescription)
 * @query   order      - asc | desc (défaut : desc)
 */
router.get('/', OrdonnanceController.getAll);

// ================================================================
// Routes paramétrées /:ordonnanceId
// ================================================================

/**
 * @route   GET /api/ordonnances/:ordonnanceId
 * @desc    Récupérer les détails complets d'une ordonnance
 *          (patient, mesures, ventes associées, commandes atelier)
 * @access  Tous les rôles (isolation tenant)
 * @param   ordonnanceId - UUID de l'ordonnance
 */
router.get('/:ordonnanceId', OrdonnanceController.getById);

/**
 * @route   PATCH /api/ordonnances/:ordonnanceId
 * @desc    Modifier les mesures ou les métadonnées d'une ordonnance
 *          Le patientId n'est PAS modifiable.
 * @access  ADMIN, VENDEUR
 * @param   ordonnanceId - UUID de l'ordonnance
 */
router.patch(
    '/:ordonnanceId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    OrdonnanceController.update
);

/**
 * @route   DELETE /api/ordonnances/:ordonnanceId
 * @desc    Supprimer une ordonnance (bloqué si liée à des ventes ou commandes)
 * @access  ADMIN, SUPER_ADMIN uniquement
 * @param   ordonnanceId - UUID de l'ordonnance
 */
router.delete(
    '/:ordonnanceId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    OrdonnanceController.delete
);

export default  router;
