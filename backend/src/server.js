import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT;
const ENV = process.env.NODE_ENV || 'development';

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║          NASS-OPTIMANAGE API - Multi-Tenant        ║
╠════════════════════════════════════════════════════╣
║  Statut       : Serveur démarré avec succès        ║
║  Port         : ${String(PORT).padEnd(35)}║
║  Environnement: ${ENV.padEnd(35)}║
║  URL          : http://localhost:${String(PORT).padEnd(19)}║
╚════════════════════════════════════════════════════╝
    `);
});