import { Router } from 'express';
import ProduitController from '../controllers/produit.controller.js';
import {
    authenticate,
    authorize
} from '../middlewares/auth.middleware.js';
import pkg from '@prisma/client';
const { Role } = pkg;

const router = Router();

/**
 * Routes pour la gestion des Produits
 * Toutes les routes nécessitent une authentification.
 */
router.use(authenticate);

// ================================================================
// Routes statiques — déclarées AVANT les routes paramétrées
// pour éviter qu'Express ne les confonde avec /:produitId
// ================================================================

/**
 * @route   GET /api/produits/search
 * @desc    Recherche avancée multi-critères
 * @access  Tous les rôles
 * @query   q             - Terme libre (reference, marque)
 * @query   type          - TypeProduit (MONTURE|VERRE|LENTILLE|ACCESSOIRE)
 * @query   prixMin       - Prix de vente minimum
 * @query   prixMax       - Prix de vente maximum
 * @query   enStock       - 'true' → uniquement les produits disponibles
 * @query   fournisseurId - Filtrer par fournisseur
 * @query   page, limit   - Pagination
 */
router.get('/search', ProduitController.search);

/**
 * @route   GET /api/produits/stock/global
 * @desc    Vue d'ensemble du stock de la boutique
 *          (totaux, valeurs, répartition par type, alertes rupture)
 * @access  ADMIN, VENDEUR
 */
router.get(
    '/stock/global',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    ProduitController.getStockGlobal
);

// ================================================================
// Routes de création et listage
// ================================================================

/**
 * @route   POST /api/produits
 * @desc    Créer un nouveau produit
 * @access  ADMIN
 * @body    reference       - Référence unique dans la boutique (obligatoire)
 * @body    type            - TypeProduit : MONTURE|VERRE|LENTILLE|ACCESSOIRE (obligatoire)
 * @body    marque          - Marque (optionnel)
 * @body    prixAchat       - Prix d'achat (obligatoire, ≥ 0)
 * @body    prixVente       - Prix de vente (obligatoire, ≥ 0)
 * @body    quantiteEnStock - Stock initial (défaut : 0)
 * @body    fournisseurId   - UUID du fournisseur (optionnel)
 */
router.post(
    '/',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    ProduitController.create
);

/**
 * @route   GET /api/produits
 * @desc    Lister les produits de la boutique courante
 * @access  Tous les rôles
 * @query   page          - Numéro de page (défaut : 1)
 * @query   limit         - Éléments par page (défaut : 10)
 * @query   search        - Terme libre (reference, marque)
 * @query   type          - Filtrer par TypeProduit
 * @query   fournisseurId - Filtrer par fournisseur
 * @query   stockBas      - 'true' → uniquement produits en rupture (stock = 0)
 * @query   sortBy        - Champ de tri : reference|marque|prixVente|prixAchat|quantiteEnStock|type
 * @query   order         - asc | desc (défaut : asc)
 */
router.get('/', ProduitController.getAll);

// ================================================================
// Routes paramétrées /:produitId
// ================================================================

/**
 * @route   GET /api/produits/:produitId
 * @desc    Récupérer les détails d'un produit
 * @access  Tous les rôles (isolation tenant)
 * @param   produitId - UUID du produit
 */
router.get('/:produitId', ProduitController.getById);

/**
 * @route   GET /api/produits/:produitId/mouvements
 * @desc    Historique des mouvements de stock d'un produit
 * @access  ADMIN, VENDEUR
 * @param   produitId     - UUID du produit
 * @query   page          - Numéro de page (défaut : 1)
 * @query   limit         - Éléments par page (défaut : 20)
 * @query   typeMouvement - ENTREE|SORTIE|AJUSTEMENT
 * @query   dateDebut     - Borne inférieure (ISO 8601)
 * @query   dateFin       - Borne supérieure (ISO 8601)
 */
router.get(
    '/:produitId/mouvements',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    ProduitController.getMouvements
);

/**
 * @route   GET /api/produits/:produitId/stats
 * @desc    Statistiques d'un produit
 *          (stock, prix, marge, ventes, retours, mouvements)
 * @access  ADMIN, VENDEUR
 * @param   produitId - UUID du produit
 */
router.get(
    '/:produitId/stats',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    ProduitController.getStats
);

/**
 * @route   PATCH /api/produits/:produitId
 * @desc    Mettre à jour les informations commerciales d'un produit
 *          (reference, type, marque, prixAchat, prixVente, fournisseur)
 * @access  ADMIN
 * @param   produitId     - UUID du produit
 *
 * ⚠️  NE PAS utiliser cette route pour modifier le stock.
 *     Utiliser POST /api/produits/:produitId/stock à la place.
 */
router.patch(
    '/:produitId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    ProduitController.update
);

/**
 * @route   POST /api/produits/:produitId/stock
 * @desc    Enregistrer un mouvement de stock (ENTREE / SORTIE / AJUSTEMENT)
 * @access  ADMIN, VENDEUR
 * @param   produitId     - UUID du produit
 * @body    typeMouvement - ENTREE | SORTIE | AJUSTEMENT (obligatoire)
 * @body    quantite      - Entier strictement positif (obligatoire)
 *                          Pour AJUSTEMENT : nouvelle valeur absolue du stock
 * @body    motif         - Raison du mouvement (optionnel)
 */
router.post(
    '/:produitId/stock',
    authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.VENDEUR),
    ProduitController.ajusterStock
);

/**
 * @route   DELETE /api/produits/:produitId
 * @desc    Supprimer un produit (bloqué s'il a un historique commercial)
 * @access  ADMIN, SUPER_ADMIN uniquement
 * @param   produitId - UUID du produit
 */
router.delete(
    '/:produitId',
    authorize(Role.SUPER_ADMIN, Role.ADMIN),
    ProduitController.delete
);

export default router;
