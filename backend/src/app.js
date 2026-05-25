// Importations d'express
import express from 'express';

// Création de l'application express
const app = express();

// Middleware pour parser le corps des requêtes en JSON
app.use(express.json());

// Route de test
app.get('/', (req, res) => {
    res.json({ status: 'Ok' });
});

// Exportation de l'application
export default app;