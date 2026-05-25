// Importation des variables d'environnement
import "dotenv/config";
// Importation de l'application express
import app from './app.js';

// Démarrage du serveur
const PORT = process.env.PORT;
app.listen(PORT, () => {
    console.log(`API en cours d'exécution sur le port http://localhost:${PORT}`);
});