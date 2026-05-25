# NASS-OPTIMANAGE

Plateforme de gestion multi-boutiques pour opticiens. Elle couvre l'ensemble du flux commercial : patients, ordonnances, devis, ventes, atelier de montage, paiements, retours et traçabilité complète des stocks et actions.

---

## Stack technique

| Couche | Technologie |
| ------ | ----------- |
| Frontend | React 19 + Vite 8 + TailwindCSS |
| Backend | Node.js (ESM) + Express 5 |
| ORM | Prisma 7 |
| Base de données | PostgreSQL |
| Sécurité | Helmet + CORS |
| Logs HTTP | Morgan |

---

## Fonctionnalités

- **Multi-tenant** — chaque boutique est isolée, données et utilisateurs séparés
- **Patients & Ordonnances** — suivi des prescriptions optiques (sphère, cylindre, axe, addition, écart pupillaire)
- **Devis** — création, envoi, acceptation/refus avec lignes de produits
- **Ventes** — conversion devis → vente, gestion des remises et du reste à payer
- **Paiements** — multiples méthodes (espèces, carte, mobile money, chèque)
- **Atelier** — commandes de montage avec type de verre, traitements et hauteurs
- **Retours** — gestion des retours articles avec statut de remboursement
- **Stock** — mouvements tracés (entrée, sortie, ajustement) avec snapshots avant/après
- **Historique** — audit log JSON de toutes les actions (création, modification, suppression, connexion)

---

## Structure du projet

```text
NASS-OPTIMANAGE/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma       # Schéma de base de données
│   ├── src/
│   │   └── server.js           # Point d'entrée Express
│   └── package.json
├── frontend/
│   ├── src/
│   │   └── main.jsx            # Point d'entrée React
│   ├── vite.config.js
│   └── package.json
├── .gitignore
└── README.md
```

---

## Prérequis

- [Node.js](https://nodejs.org/) >= 20
- [PostgreSQL](https://www.postgresql.org/) >= 14
- npm >= 10

---

## Installation

### 1. Cloner le projet

```bash
git clone <url-du-repo>
cd NASS-OPTIMANAGE
```

### 2. Backend

```bash
cd backend
npm install
```

Créer le fichier `.env` à la racine du dossier `backend/` :

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/nass_optimanage"
PORT=3000
```

Configurer Prisma et lancer la migration initiale :

```bash
npx prisma migrate dev --name init
npx prisma generate
```

Démarrer le serveur :

```bash
# développement (avec rechargement automatique)
npm run dev

# production
npm start
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Scripts disponibles

### Backend

| Commande | Description |
| -------- | ----------- |
| `npm run dev` | Démarre le serveur en mode développement (nodemon) |
| `npm start` | Démarre le serveur en production |
| `npx prisma migrate dev` | Crée et applique une migration |
| `npx prisma studio` | Ouvre l'interface visuelle de la base de données |

### Frontend

| Commande | Description |
| -------- | ----------- |
| `npm run dev` | Démarre Vite en mode développement |
| `npm run build` | Compile pour la production |
| `npm run preview` | Prévisualise le build de production |
| `npm run lint` | Analyse le code avec ESLint |

---

## Modèle de données

Les entités principales et leurs relations :

```text
Tenant (boutique)
├── Utilisateur (employés : admin, vendeur, monteur)
├── Patient
│   └── Ordonnance
├── Fournisseur
├── Produit (monture, verre, lentille, accessoire)
├── Devis → LigneDevis
├── Vente → LigneVente → Paiement
│   └── CommandeAtelier (montage)
│   └── Retour → LigneRetour
├── MouvementStock (traçabilité stock)
└── HistoriqueAction (audit log)
```

---

## Auteur

**Yapeaud Beda** — [yapoabed@gmail.com](mailto:yapoabed@gmail.com)
