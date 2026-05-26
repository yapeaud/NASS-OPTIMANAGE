// Charge les variables d'environnement depuis le fichier .env
import dotenv from 'dotenv';

dotenv.config();

// Centralise toutes les variables d'environnement utilisées dans l'application
export const env = {
	// Mode d'exécution : 'development', 'production' ou 'test'
	NODE_ENV: process.env.NODE_ENV ?? 'development',
	// Port d'écoute du serveur HTTP
	PORT: Number(process.env.PORT ?? 3000),
	// URL de connexion à la base de données (ex: postgresql://user:pass@host/db)
	DATABASE_URL: process.env.DATABASE_URL,
};

// Arrêt immédiat au démarrage si la variable critique est absente
if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL est manquant dans .env');
}