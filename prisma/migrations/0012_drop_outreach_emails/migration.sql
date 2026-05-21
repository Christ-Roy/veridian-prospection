-- Sprint A dette tech (T9) — DROP TABLE outreach_emails
--
-- Table vidée et abandonnée depuis commit 61427f9 (cleanup Claude + email himalaya).
-- 0 rows en staging et prod au moment de la migration.
-- Déjà retirée du schema Prisma (plus aucun reader/writer côté code).
--
-- Idempotent via IF EXISTS : si la table a déjà été dropée manuellement,
-- la migration reste applicable sans erreur.

DROP TABLE IF EXISTS "outreach_emails";
