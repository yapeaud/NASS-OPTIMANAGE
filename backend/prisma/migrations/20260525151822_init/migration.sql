-- CreateEnum
CREATE TYPE "MethodePaiement" AS ENUM ('ESPECES', 'CARTE', 'MOBILE_MONEY', 'CHEQUE');

-- CreateEnum
CREATE TYPE "StatutPaiement" AS ENUM ('PAYE', 'PARTIEL', 'IMPAYE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VENDEUR', 'MONTEUR');

-- CreateEnum
CREATE TYPE "TypeProduit" AS ENUM ('MONTURE', 'VERRE', 'LENTILLE', 'ACCESSOIRE');

-- CreateEnum
CREATE TYPE "StatutAtelier" AS ENUM ('COMMANDE_PASSEE', 'EN_COURS', 'TERMINE', 'PRODUIT_PRET');

-- CreateEnum
CREATE TYPE "StatutDevis" AS ENUM ('BROUILLON', 'ENVOYE', 'ACCEPTE', 'REFUSE', 'EXPIRE');

-- CreateEnum
CREATE TYPE "TypeVerre" AS ENUM ('UNIFOCAL', 'BIFOCAL', 'PROGRESSIF', 'LENTILLE_CONTACT');

-- CreateEnum
CREATE TYPE "StatutRetour" AS ENUM ('EN_ATTENTE', 'APPROUVE', 'REFUSE', 'REMBOURSE');

-- CreateEnum
CREATE TYPE "TypeAction" AS ENUM ('CREATION', 'MODIFICATION', 'SUPPRESSION', 'CONNEXION', 'DECONNEXION', 'CHANGEMENT_STATUT');

-- CreateEnum
CREATE TYPE "TypeMouvement" AS ENUM ('ENTREE', 'SORTIE', 'AJUSTEMENT');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nomBoutique" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utilisateur" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "motDePasse" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" SERIAL NOT NULL,
    "patientId" TEXT NOT NULL,
    "nomComplet" TEXT NOT NULL,
    "telephone" TEXT,
    "profession" TEXT,
    "dateNaissance" TIMESTAMP(3),
    "nomAssurance" TEXT,
    "numeroAssurance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ordonnance" (
    "id" SERIAL NOT NULL,
    "ordonnanceId" TEXT NOT NULL,
    "datePrescription" TIMESTAMP(3),
    "nomMedecin" TEXT,
    "sphereOD" DECIMAL(65,30),
    "cylindreOD" DECIMAL(65,30),
    "axeOD" INTEGER,
    "additionOD" DECIMAL(65,30),
    "ecartPupillaireOD" DECIMAL(65,30),
    "sphereOG" DECIMAL(65,30),
    "cylindreOG" DECIMAL(65,30),
    "axeOG" INTEGER,
    "additionOG" DECIMAL(65,30),
    "ecartPupillaireOG" DECIMAL(65,30),
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "patientId" TEXT NOT NULL,

    CONSTRAINT "Ordonnance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" SERIAL NOT NULL,
    "fournisseurId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "contact" TEXT,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produit" (
    "id" SERIAL NOT NULL,
    "produitId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "reference" TEXT NOT NULL,
    "type" "TypeProduit" NOT NULL,
    "marque" TEXT,
    "prixAchat" DOUBLE PRECISION NOT NULL,
    "prixVente" DOUBLE PRECISION NOT NULL,
    "quantiteEnStock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Produit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Devis" (
    "id" SERIAL NOT NULL,
    "devisId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT,
    "userId" TEXT NOT NULL,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateExpiration" TIMESTAMP(3),
    "montantTotal" DOUBLE PRECISION NOT NULL,
    "remise" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "statut" "StatutDevis" NOT NULL,

    CONSTRAINT "Devis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneDevis" (
    "id" SERIAL NOT NULL,
    "ligneDevisId" TEXT NOT NULL,
    "devisId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "prixUnitaire" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LigneDevis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vente" (
    "id" SERIAL NOT NULL,
    "venteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT,
    "ordonnanceId" TEXT,
    "devisId" TEXT,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montantTotal" DOUBLE PRECISION NOT NULL,
    "remise" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resteAPayer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statut" "StatutPaiement" NOT NULL,

    CONSTRAINT "Vente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneVente" (
    "id" SERIAL NOT NULL,
    "ligneVenteId" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "prixUnitaire" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LigneVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paiement" (
    "id" SERIAL NOT NULL,
    "paiementId" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "userId" TEXT,
    "datePaiement" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montant" DOUBLE PRECISION NOT NULL,
    "methode" "MethodePaiement" NOT NULL,

    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandeAtelier" (
    "id" SERIAL NOT NULL,
    "commandeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venteId" TEXT,
    "ordonnanceId" TEXT,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" "StatutAtelier" NOT NULL,
    "dateExecutionJour" TIMESTAMP(3),
    "typeVerre" "TypeVerre",
    "traitements" TEXT[],
    "hauteurMontageOD" DECIMAL(65,30),
    "hauteurMontageOG" DECIMAL(65,30),
    "notes" TEXT,

    CONSTRAINT "CommandeAtelier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retour" (
    "id" SERIAL NOT NULL,
    "retourId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateRetour" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motif" TEXT,
    "montantRembourse" DOUBLE PRECISION NOT NULL,
    "statut" "StatutRetour" NOT NULL,

    CONSTRAINT "Retour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneRetour" (
    "id" SERIAL NOT NULL,
    "ligneRetourId" TEXT NOT NULL,
    "retourId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "prixUnitaire" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LigneRetour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoriqueAction" (
    "id" SERIAL NOT NULL,
    "historiqueId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "TypeAction" NOT NULL,
    "modele" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "anciennesValeurs" JSONB,
    "nouvellesValeurs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoriqueAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" SERIAL NOT NULL,
    "mouvementId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "userId" TEXT,
    "venteId" TEXT,
    "retourId" TEXT,
    "type" "TypeMouvement" NOT NULL,
    "quantite" INTEGER NOT NULL,
    "quantiteAvant" INTEGER NOT NULL,
    "quantiteApres" INTEGER NOT NULL,
    "motif" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_tenantId_key" ON "Tenant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_userId_key" ON "Utilisateur"("userId");

-- CreateIndex
CREATE INDEX "Utilisateur_userId_idx" ON "Utilisateur"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_tenantId_email_key" ON "Utilisateur"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientId_key" ON "Patient"("patientId");

-- CreateIndex
CREATE INDEX "Patient_tenantId_idx" ON "Patient"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Ordonnance_ordonnanceId_key" ON "Ordonnance"("ordonnanceId");

-- CreateIndex
CREATE INDEX "Ordonnance_ordonnanceId_idx" ON "Ordonnance"("ordonnanceId");

-- CreateIndex
CREATE INDEX "Ordonnance_tenantId_idx" ON "Ordonnance"("tenantId");

-- CreateIndex
CREATE INDEX "Ordonnance_patientId_idx" ON "Ordonnance"("patientId");

-- CreateIndex
CREATE INDEX "Ordonnance_userId_idx" ON "Ordonnance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Fournisseur_fournisseurId_key" ON "Fournisseur"("fournisseurId");

-- CreateIndex
CREATE INDEX "Fournisseur_tenantId_idx" ON "Fournisseur"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Produit_produitId_key" ON "Produit"("produitId");

-- CreateIndex
CREATE INDEX "Produit_tenantId_idx" ON "Produit"("tenantId");

-- CreateIndex
CREATE INDEX "Produit_fournisseurId_idx" ON "Produit"("fournisseurId");

-- CreateIndex
CREATE UNIQUE INDEX "Produit_tenantId_reference_key" ON "Produit"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Devis_devisId_key" ON "Devis"("devisId");

-- CreateIndex
CREATE INDEX "Devis_tenantId_idx" ON "Devis"("tenantId");

-- CreateIndex
CREATE INDEX "Devis_patientId_idx" ON "Devis"("patientId");

-- CreateIndex
CREATE INDEX "Devis_userId_idx" ON "Devis"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneDevis_ligneDevisId_key" ON "LigneDevis"("ligneDevisId");

-- CreateIndex
CREATE INDEX "LigneDevis_devisId_idx" ON "LigneDevis"("devisId");

-- CreateIndex
CREATE INDEX "LigneDevis_produitId_idx" ON "LigneDevis"("produitId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_venteId_key" ON "Vente"("venteId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_devisId_key" ON "Vente"("devisId");

-- CreateIndex
CREATE INDEX "Vente_tenantId_idx" ON "Vente"("tenantId");

-- CreateIndex
CREATE INDEX "Vente_userId_idx" ON "Vente"("userId");

-- CreateIndex
CREATE INDEX "Vente_patientId_idx" ON "Vente"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneVente_ligneVenteId_key" ON "LigneVente"("ligneVenteId");

-- CreateIndex
CREATE INDEX "LigneVente_venteId_idx" ON "LigneVente"("venteId");

-- CreateIndex
CREATE INDEX "LigneVente_produitId_idx" ON "LigneVente"("produitId");

-- CreateIndex
CREATE UNIQUE INDEX "Paiement_paiementId_key" ON "Paiement"("paiementId");

-- CreateIndex
CREATE INDEX "Paiement_venteId_idx" ON "Paiement"("venteId");

-- CreateIndex
CREATE INDEX "Paiement_userId_idx" ON "Paiement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandeAtelier_commandeId_key" ON "CommandeAtelier"("commandeId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandeAtelier_venteId_key" ON "CommandeAtelier"("venteId");

-- CreateIndex
CREATE INDEX "CommandeAtelier_tenantId_idx" ON "CommandeAtelier"("tenantId");

-- CreateIndex
CREATE INDEX "CommandeAtelier_ordonnanceId_idx" ON "CommandeAtelier"("ordonnanceId");

-- CreateIndex
CREATE UNIQUE INDEX "Retour_retourId_key" ON "Retour"("retourId");

-- CreateIndex
CREATE INDEX "Retour_tenantId_idx" ON "Retour"("tenantId");

-- CreateIndex
CREATE INDEX "Retour_venteId_idx" ON "Retour"("venteId");

-- CreateIndex
CREATE INDEX "Retour_userId_idx" ON "Retour"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneRetour_ligneRetourId_key" ON "LigneRetour"("ligneRetourId");

-- CreateIndex
CREATE INDEX "LigneRetour_retourId_idx" ON "LigneRetour"("retourId");

-- CreateIndex
CREATE INDEX "LigneRetour_produitId_idx" ON "LigneRetour"("produitId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoriqueAction_historiqueId_key" ON "HistoriqueAction"("historiqueId");

-- CreateIndex
CREATE INDEX "HistoriqueAction_tenantId_idx" ON "HistoriqueAction"("tenantId");

-- CreateIndex
CREATE INDEX "HistoriqueAction_userId_idx" ON "HistoriqueAction"("userId");

-- CreateIndex
CREATE INDEX "HistoriqueAction_modele_entiteId_idx" ON "HistoriqueAction"("modele", "entiteId");

-- CreateIndex
CREATE INDEX "HistoriqueAction_createdAt_idx" ON "HistoriqueAction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementStock_mouvementId_key" ON "MouvementStock"("mouvementId");

-- CreateIndex
CREATE INDEX "MouvementStock_tenantId_idx" ON "MouvementStock"("tenantId");

-- CreateIndex
CREATE INDEX "MouvementStock_produitId_idx" ON "MouvementStock"("produitId");

-- CreateIndex
CREATE INDEX "MouvementStock_venteId_idx" ON "MouvementStock"("venteId");

-- CreateIndex
CREATE INDEX "MouvementStock_retourId_idx" ON "MouvementStock"("retourId");

-- CreateIndex
CREATE INDEX "MouvementStock_createdAt_idx" ON "MouvementStock"("createdAt");

-- AddForeignKey
ALTER TABLE "Utilisateur" ADD CONSTRAINT "Utilisateur_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ordonnance" ADD CONSTRAINT "Ordonnance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ordonnance" ADD CONSTRAINT "Ordonnance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ordonnance" ADD CONSTRAINT "Ordonnance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("patientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fournisseur" ADD CONSTRAINT "Fournisseur_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produit" ADD CONSTRAINT "Produit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produit" ADD CONSTRAINT "Produit_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("fournisseurId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("patientId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDevis" ADD CONSTRAINT "LigneDevis_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("devisId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDevis" ADD CONSTRAINT "LigneDevis_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("produitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("patientId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_ordonnanceId_fkey" FOREIGN KEY ("ordonnanceId") REFERENCES "Ordonnance"("ordonnanceId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("devisId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("venteId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("produitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("venteId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeAtelier" ADD CONSTRAINT "CommandeAtelier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeAtelier" ADD CONSTRAINT "CommandeAtelier_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("venteId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeAtelier" ADD CONSTRAINT "CommandeAtelier_ordonnanceId_fkey" FOREIGN KEY ("ordonnanceId") REFERENCES "Ordonnance"("ordonnanceId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("venteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneRetour" ADD CONSTRAINT "LigneRetour_retourId_fkey" FOREIGN KEY ("retourId") REFERENCES "Retour"("retourId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneRetour" ADD CONSTRAINT "LigneRetour_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("produitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoriqueAction" ADD CONSTRAINT "HistoriqueAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoriqueAction" ADD CONSTRAINT "HistoriqueAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("produitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("venteId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_retourId_fkey" FOREIGN KEY ("retourId") REFERENCES "Retour"("retourId") ON DELETE SET NULL ON UPDATE CASCADE;
