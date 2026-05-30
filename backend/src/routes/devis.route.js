import { Router } from 'express';
import DevisController from '../controllers/devis.controller.js';
import {
    authenticate,
    authorize
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Devis
 * Toutes les routes nécessitent une authentification.
 */
router.use(authenticate);

// ================================================================
// Routes statiques — déclarées AVANT /:devisId pour éviter
// tout conflit de routage Express
// ================================================================

/**
 * @route   GET /api/devis/search
 * @desc    Recherche avancée de devis multi-critères
 * @access  Tous les rôles
 * @query   patientNom  - Nom du patient (recherche partielle insensible à la casse)
 * @query   statut      - BROUILLON | ENVOYE | ACCEPTE | REFUSE | EXPIRE
 * @query   montantMin  - Montant total minimum
 * @query   montantMax  - Montant total maximum
 * @query   dateDebut   - Borne inférieure de création (ISO 8601)
 * @query   dateFin     - Borne supérieure de création (ISO 8601)
 * @query   page, limit - Pagination (défaut : 1 / 10)
 */
router.get('/search', DevisController.search);

/**
 * @route   GET /api/devis/stats/global
 * @desc    Statistiques globales des devis de la boutique
 *          (totaux, taux de conversion, répartition par statut)
 * @access  ADMIN, VENDEUR
 * @query   dateDebut - Borne inférieure de la période (optionnel)
 * @query   dateFin   - Borne supérieure de la période (optionnel)
 */
router.get(
    '/stats/global',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    DevisController.getStatsGlobal
);

// ================================================================
// Routes de création et listage
// ================================================================

/**
 * @route   POST /api/devis
 * @desc    Créer un nouveau devis (statut initial : BROUILLON)
 * @access  ADMIN, VENDEUR
 * @body    lignes[]            - Tableau de lignes produits (obligatoire, ≥ 1)
 *            lignes[].produitId  - UUID du produit (obligatoire)
 *            lignes[].quantite   - Quantité entière > 0 (obligatoire)
 *            lignes[].prixUnitaire - Prix figé (optionnel, défaut : prixVente catalogue)
 * @body    remise              - Montant remisé en FCFA (optionnel, défaut : 0)
 * @body    patientId           - UUID du patient (optionnel)
 * @body    dateExpiration      - Date limite de validité ISO 8601 (optionnel)
 * @body    notes               - Observations libres (optionnel)
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    DevisController.create
);

/**
 * @route   GET /api/devis
 * @desc    Lister les devis de la boutique courante
 * @access  Tous les rôles
 * @query   page      - Numéro de page (défaut : 1)
 * @query   limit     - Éléments par page (défaut : 10)
 * @query   statut    - BROUILLON | ENVOYE | ACCEPTE | REFUSE | EXPIRE
 * @query   patientId - Filtrer par patient
 * @query   userId    - Filtrer par créateur du devis
 * @query   dateDebut - Borne inférieure de création (ISO 8601)
 * @query   dateFin   - Borne supérieure de création (ISO 8601)
 * @query   expire    - 'true' → uniquement les devis expirés non encore marqués
 * @query   sortBy    - dateCreation | dateExpiration | montantTotal | statut (défaut : dateCreation)
 * @query   order     - asc | desc (défaut : desc)
 */
router.get('/', DevisController.getAll);

// ================================================================
// Routes paramétrées /:devisId
// ================================================================

/**
 * @route   GET /api/devis/:devisId
 * @desc    Récupérer les détails complets d'un devis
 *          Déclenche la mise à jour automatique vers EXPIRE si nécessaire.
 * @access  Tous les rôles (isolation tenant)
 * @param   devisId - UUID du devis
 */
router.get('/:devisId', DevisController.getById);

/**
 * @route   PATCH /api/devis/:devisId
 * @desc    Modifier un devis (BROUILLON uniquement)
 *          La modification des lignes remplace entièrement l'ancien jeu.
 * @access  ADMIN, VENDEUR
 * @param   devisId        - UUID du devis
 * @body    lignes[]       - Nouveau jeu complet de lignes (optionnel)
 * @body    remise         - Nouvelle remise (optionnel)
 * @body    patientId      - Nouveau patient (optionnel)
 * @body    dateExpiration - Nouvelle date d'expiration (optionnel, null pour supprimer)
 * @body    notes          - Nouvelles notes (optionnel)
 */
router.patch(
    '/:devisId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    DevisController.update
);

/**
 * @route   PATCH /api/devis/:devisId/statut
 * @desc    Changer le statut d'un devis selon les transitions autorisées :
 *            BROUILLON → ENVOYE
 *            ENVOYE    → ACCEPTE | REFUSE
 *          (EXPIRE est automatique, pas manuel)
 * @access  ADMIN, VENDEUR
 * @param   devisId - UUID du devis
 * @body    statut  - Nouveau statut cible (obligatoire)
 * @body    motif   - Raison du changement (optionnel, utile pour REFUSE)
 */
router.patch(
    '/:devisId/statut',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    DevisController.changerStatut
);

/**
 * @route   POST /api/devis/:devisId/dupliquer
 * @desc    Créer un nouveau devis BROUILLON à partir d'un devis existant
 *          (mêmes lignes, même patient, pas de dateExpiration par défaut)
 * @access  ADMIN, VENDEUR
 * @param   devisId        - UUID du devis source
 * @body    dateExpiration - Date d'expiration du duplicata (optionnel)
 */
router.post(
    '/:devisId/dupliquer',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    DevisController.dupliquer
);

/**
 * @route   DELETE /api/devis/:devisId
 * @desc    Supprimer un devis (BROUILLON uniquement, sans vente associée)
 * @access  ADMIN, SUPER_ADMIN uniquement
 * @param   devisId - UUID du devis
 */
router.delete(
    '/:devisId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    DevisController.delete
);

export default router;
