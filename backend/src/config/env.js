import dotenv from 'dotenv';

dotenv.config();

export const env = {
	NODE_ENV: process.env.NODE_ENV ?? 'development',
	PORT: Number(process.env.PORT ?? 3000),
	DATABASE_URL: process.env.DATABASE_URL,
};

if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL est manquant dans .env');
}