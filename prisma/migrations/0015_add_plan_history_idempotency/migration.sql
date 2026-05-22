-- Conformité CONTRAT-BILLING.md v2 §3.4.3 — idempotence du consumer update-plan.
--
-- Le payload `update-plan` v2 porte un `idempotency_key` (uuid). Le Hub peut
-- ré-émettre le même `update-plan` (retry Stripe, replay) — l'app ne doit pas
-- double-appliquer le changement de plan.
--
-- La table d'audit `veridian_plan_history` est le registre naturel du
-- dédoublonnage : une ligne = un changement de plan appliqué. On y ajoute
-- `idempotency_key` + un index UNIQUE dessus. Un replay du même key viole la
-- contrainte unique → le handler le détecte et renvoie un 200 no-op (§3.6).
--
-- Colonne NULLABLE : les lignes historiques (changements pré-v2) n'ont pas de
-- clé. L'index unique PARTIEL `WHERE idempotency_key IS NOT NULL` n'impose la
-- contrainte que sur les lignes v2 — pas de collision sur les NULL existants.
--
-- Migration ADDITIVE (ADD COLUMN nullable + CREATE INDEX) — pas de DROP, pas
-- d'ALTER NOT NULL sur des rows existantes. Réversible.

ALTER TABLE veridian_plan_history
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS veridian_plan_history_idempotency_key_key
  ON veridian_plan_history (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
