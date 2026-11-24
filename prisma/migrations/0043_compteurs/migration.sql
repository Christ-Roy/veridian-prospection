-- Compteurs durables (24/11, VER-242) : quota de vérification et limite de connexion, hors de la mémoire du processus.
CREATE TABLE IF NOT EXISTS "compteurs" (
  "cle" TEXT NOT NULL,
  "fenetre" TIMESTAMPTZ NOT NULL,
  "n" INTEGER NOT NULL,
  PRIMARY KEY ("cle", "fenetre")
);
