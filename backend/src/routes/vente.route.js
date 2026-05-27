import { Router } from "express";
import VenteController from "../controllers/vente.controller.js";
import {
    authenticate,
    authorize
} from "../middlewares/auth.middleware.js";
import pkg from "@prisma/client";
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Ventes
 * Toutes les routes nécessitent une authentification.
 */
router.use(authenticate);

// ================================================================
// Routes statiques — déclarées AVANT /:venteId pour éviter
// tout conflit de routage Express
// ================================================================

/**
 * @route   GET /api/ventes/search
 * @desc    Recherche avancée de ventes multi-critères
 * @access  Tous les rôles
 * @query   patientNom  - Nom du patient (recherche partielle)
 * @query   statut      - PAYE | PARTIEL | IMPAYE
 * @query   montantMin  - Montant minimum
 * @query   montantMax  - Montant maximum
 * @query   dateDebut   - Borne inférieure (ISO 8601)
 * @query   dateFin     - Borne supérieure (ISO 8601)
 * @query   page, limit - Pagination
 */
router.get('/search', VenteController.search);

/**
 * @route   GET /api/ventes/stats/global
 * @desc    Statistiques globales des ventes de la boutique
 *          (CA, marges, top produits, top vendeurs, évolution)
 * @access  ADMIN, VENDEUR
 * @query   dateDebut - Borne inférieure de la période (optionnel)
 * @query   dateFin   - Borne supérieure de la période (optionnel)
 */
router.get(
    '/stats/global',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    VenteController.getStatsGlobal
);

// ================================================================
// Routes de création et listage
// ================================================================

/**
 * @route   POST /api/ventes
 * @desc    Créer une nouvelle vente
 * @access  ADMIN, VENDEUR
 * @body    lignes[]            - Tableau de lignes produits (obligatoire)
 *            lignes[].produitId  - UUID du produit (obligatoire)
 *            lignes[].quantite   - Quantité (entier > 0, obligatoire)
 *            lignes[].prixUnitaire - Prix figé (optionnel, défaut : prixVente catalogue)
 * @body    remise              - Montant remisé en FCFA (optionnel, défaut : 0)
 * @body    patientId           - UUID du patient (optionnel)
 * @body    ordonnanceId        - UUID de l'ordonnance (optionnel)
 * @body    devisId             - UUID du devis ACCEPTE à convertir (optionnel)
 * @body    paiementInitial     - Premier paiement immédiat (optionnel)
 *            paiementInitial.montant - Montant (obligatoire si fourni)
 *            paiementInitial.methode - ESPECES|CARTE|MOBILE_MONEY|CHEQUE
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    VenteController.create
);

/**
 * @route   GET /api/ventes
 * @desc    Lister les ventes de la boutique courante
 * @access  Tous les rôles
 * @query   page      - Numéro de page (défaut : 1)
 * @query   limit     - Éléments par page (défaut : 10)
 * @query   statut    - Filtrer par statut : PAYE | PARTIEL | IMPAYE
 * @query   patientId - Filtrer par patient
 * @query   userId    - Filtrer par vendeur
 * @query   dateDebut - Borne inférieure (ISO 8601)
 * @query   dateFin   - Borne supérieure (ISO 8601)
 * @query   sortBy    - dateCreation | montantTotal | resteAPayer | statut (défaut : dateCreation)
 * @query   order     - asc | desc (défaut : desc)
 */
router.get('/', VenteController.getAll);

// ================================================================
// Routes paramétrées /:venteId
// ================================================================

/**
 * @route   GET /api/ventes/:venteId
 * @desc    Récupérer les détails complets d'une vente
 *          (lignes, paiements, patient, ordonnance, devis, commande atelier, retours)
 * @access  Tous les rôles (isolation tenant)
 * @param   venteId - UUID de la vente
 */
router.get('/:venteId', VenteController.getById);

/**
 * @route   GET /api/ventes/:venteId/paiements
 * @desc    Lister les paiements d'une vente avec le récapitulatif financier
 * @access  Tous les rôles (isolation tenant)
 * @param   venteId - UUID de la vente
 */
router.get('/:venteId/paiements', VenteController.getPaiements);

/**
 * @route   POST /api/ventes/:venteId/paiements
 * @desc    Enregistrer un nouveau paiement sur une vente
 *          Recalcule automatiquement resteAPayer et le statut.
 * @access  ADMIN, VENDEUR
 * @param   venteId - UUID de la vente
 * @body    montant - Montant du paiement (obligatoire, > 0, ≤ resteAPayer)
 * @body    methode - ESPECES | CARTE | MOBILE_MONEY | CHEQUE (obligatoire)
 */
router.post(
    '/:venteId/paiements',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    VenteController.addPaiement
);

/**
 * @route   PATCH /api/ventes/:venteId/annuler
 * @desc    Annuler une vente sans paiement (remet le stock à jour)
 * @access  ADMIN, SUPER_ADMIN uniquement
 * @param   venteId - UUID de la vente
 * @body    motif   - Raison de l'annulation (optionnel)
 *
 * ⚠️  Impossible si des paiements ou des retours existent déjà.
 *     Dans ce cas, créer un Retour via /api/retours.
 */
router.patch(
    '/:venteId/annuler',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    VenteController.annuler
);

export default router;
