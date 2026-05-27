import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// Import des routes
import tenantRoutes from './routes/tenant.route.js';
import utilisateurRoutes from './routes/utilisateur.route.js';
// import patientRoutes from './routes/patient.route.js';
// import venteRoutes from './routes/vente.route.js';
// ... autres routes

const app = express();

// ======================================
// MIDDLEWARES GLOBAUX
// ======================================

app.use(helmet());

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// ======================================
// HEALTH CHECK
// ======================================

app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'L\'API NASS-OPTIMANAGE est en cours d\'exécution',
        timestamp: new Date().toISOString()
    });
});

// ======================================
// ROUTES API
// ======================================

app.get('/api', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Bienvenue sur l\'API NASS-OPTIMANAGE',
        version: '1.0.0',
        endpoints: {
            tenants: '/api/tenants',
            utilisateurs: '/api/utilisateurs',
            patients: '/api/patients',
            produits: '/api/produits',
            ventes: '/api/ventes',
            devis: '/api/devis',
            ordonnances: '/api/ordonnances',
            commandes: '/api/commandes',
            retours: '/api/retours',
            fournisseurs: '/api/fournisseurs'
        }
    });
});

app.use('/api/tenants', tenantRoutes);
// app.use('/api/utilisateurs', utilisateurRoutes);
// app.use('/api/patients', patientRoutes);
// app.use('/api/produits', produitRoutes);
// app.use('/api/ventes', venteRoutes);
// app.use('/api/devis', devisRoutes);
// app.use('/api/ordonnances', ordonnanceRoutes);
// app.use('/api/commandes', commandeRoutes);
// app.use('/api/retours', retourRoutes);
// app.use('/api/fournisseurs', fournisseurRoutes);

// ======================================
// GESTION DES ERREURS 404
// ======================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route non trouvée',
        path: req.path
    });
});

// ======================================
// MIDDLEWARE DE GESTION DES ERREURS GLOBALES
// ======================================

// Signature à 4 paramètres obligatoire pour qu'Express reconnaisse ce middleware comme gestionnaire d'erreurs
app.use((err, req, res, next) => {
    console.error('Erreur globale:', err);

    // Violation de contrainte unique Prisma
    if (err.code === 'P2002') {
        return res.status(409).json({
            success: false,
            message: 'Conflit de données : cet enregistrement existe déjà.',
            field: err.meta?.target
        });
    }

    // Enregistrement introuvable Prisma
    if (err.code === 'P2025') {
        return res.status(404).json({
            success: false,
            message: 'Enregistrement non trouvé.'
        });
    }

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

export default app;
