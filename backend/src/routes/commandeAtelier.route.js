import { Router } from 'express';
import CommandeAtelierController from '../controllers/commandeAtelier.controller.js';
import {
    authenticate,
    authorize
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Commandes Atelier
 * Toutes les routes nécessitent une authentification.
 *
 * Particularité de ce module : le rôle MONTEUR a des droits spécifiques
 * pour créer et faire avancer les commandes de montage.
 */
router.use(authenticate);

// ================================================================
// Routes statiques — déclarées AVANT /:commandeId
// ================================================================

/**
 * @route   GET /api/commandes/mes-commandes
 * @desc    Commandes du monteur connecté (MONTEUR) ou
 *          toutes les commandes de la boutique (ADMIN)
 * @access  ADMIN, MONTEUR
 * @query   statut       - Filtrer par statut
 * @query   page, limit  - Pagination (défaut : 1 / 10)
 */
router.get(
    '/mes-commandes',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.MONTEUR),
    CommandeAtelierController.mesCommandes
);

/**
 * @route   GET /api/commandes/stats/global
 * @desc    Tableau de bord atelier (totaux par statut, par type de verre,
 *          retards, top monteurs)
 * @access  ADMIN, VENDEUR
 * @query   dateDebut - Borne inférieure (optionnel)
 * @query   dateFin   - Borne supérieure (optionnel)
 */
router.get(
    '/stats/global',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    CommandeAtelierController.getStatsGlobal
);

// ================================================================
// Routes de création et listage
// ================================================================

/**
 * @route   POST /api/commandes
 * @desc    Créer une nouvelle commande atelier
 * @access  ADMIN, VENDEUR, MONTEUR
 * @body    typeVerre         - Type de verre (UNIFOCAL|BIFOCAL|PROGRESSIF|DEGRESSIF) [obligatoire]
 * @body    venteId?          - UUID de la vente associée (optionnel)
 * @body    ordonnanceId?     - UUID de l'ordonnance associée (optionnel)
 * @body    traitements?      - Description des traitements (antireflet, photochromique, etc.)
 * @body    dateExecutionJour? - Date prévue d'exécution ISO 8601 (optionnel)
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR, Role.MONTEUR),
    CommandeAtelierController.create
);

/**
 * @route   GET /api/commandes
 * @desc    Lister toutes les commandes atelier de la boutique courante
 * @access  Tous les rôles
 * @query   page         - Numéro de page (défaut : 1)
 * @query   limit        - Éléments par page (défaut : 10)
 * @query   statut       - Filtrer par statut (COMMANDE_PASSEE|EN_COURS|PRET|LIVRE|ANNULE)
 * @query   typeVerre    - Filtrer par type (UNIFOCAL|BIFOCAL|PROGRESSIF|DEGRESSIF)
 * @query   userId       - Filtrer par monteur
 * @query   venteId      - Filtrer par vente associée
 * @query   ordonnanceId - Filtrer par ordonnance associée
 * @query   dateDebut    - Borne inférieure de création
 * @query   dateFin      - Borne supérieure de création
 * @query   sortBy       - createdAt | statut | typeVerre | dateExecutionJour (défaut : createdAt)
 * @query   order        - asc | desc (défaut : desc)
 */
router.get('/', CommandeAtelierController.getAll);

// ================================================================
// Routes paramétrées /:commandeId
// ================================================================

/**
 * @route   GET /api/commandes/:commandeId
 * @desc    Récupérer les détails complets d'une commande atelier
 *          (vente, ordonnance, patient, transitions disponibles)
 * @access  Tous les rôles (isolation tenant)
 * @param   commandeId - UUID de la commande
 */
router.get('/:commandeId', CommandeAtelierController.getById);

/**
 * @route   PATCH /api/commandes/:commandeId
 * @desc    Modifier les informations d'une commande
 *          (typeVerre, traitements, dateExecutionJour)
 *          ⚠️ Bloqué si statut terminal (LIVRE ou ANNULE)
 * @access  ADMIN, MONTEUR
 * @param   commandeId - UUID de la commande
 * @body    typeVerre?          - Nouveau type de verre
 * @body    traitements?        - Nouvelles instructions de traitement (null pour effacer)
 * @body    dateExecutionJour?  - Nouvelle date prévue (null pour effacer)
 */
router.patch(
    '/:commandeId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.MONTEUR),
    CommandeAtelierController.update
);

/**
 * @route   PATCH /api/commandes/:commandeId/statut
 * @desc    Faire avancer la commande dans son cycle de vie
 *          Transitions valides :
 *            COMMANDE_PASSEE → EN_COURS | ANNULE
 *            EN_COURS        → PRET     | ANNULE
 *            PRET            → LIVRE    | ANNULE
 * @access  ADMIN, MONTEUR
 * @param   commandeId - UUID de la commande
 * @body    statut  - Nouveau statut cible (obligatoire)
 * @body    motif?  - Motif (obligatoire si statut=ANNULE)
 */
router.patch(
    '/:commandeId/statut',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.MONTEUR),
    CommandeAtelierController.changerStatut
);

export default router;
