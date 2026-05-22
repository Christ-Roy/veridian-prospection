-- Welcome leads grant (ticket refill 2/3, CONTRAT-BILLING.md §8.4).
--
-- Les "welcome leads" : un lot de leads OFFERT one-shot à la souscription
-- d'un plan (Freemium 100 / Pro 2 000 / Business 8 000 — cf shared/pricing).
-- Le Hub déclenche le crédit via POST /api/tenants/{id}/credit-leads avec
-- source='welcome'.
--
-- Invariant business : welcome leads offert UNE fois par palier de plan.
-- L'idempotency_key seul ne garantit pas ça (le Hub pourrait émettre deux
-- grants welcome avec des clés différentes — retry buggé, re-provision).
-- On ajoute donc un garde MÉTIER : un index unique sur
-- (workspace_id, welcome_plan). Deux grants welcome pour le même palier sur
-- le même workspace = violation P2002 → 200 no-op idempotent.
--
-- Les crédits source='purchase' ont welcome_plan = NULL ; Postgres traite
-- chaque NULL comme distinct dans un index unique, donc plusieurs achats sur
-- un même workspace ne violent jamais cette contrainte.
--
-- Migration ADDITIVE — ADD COLUMN nullable + CREATE INDEX. Aucun DROP,
-- aucun ALTER NOT NULL sur des rows existantes. Réversible.

-- ── 1. Colonne welcome_plan ────────────────────────────────────────────────
-- Le palier de plan (freemium|pro|business) pour lequel ce crédit welcome a
-- été accordé. NULL pour les crédits source='purchase' et pour les crédits
-- welcome historiques antérieurs à ce ticket — pas de backfill nécessaire,
-- l'index unique ne contraint pas les lignes à welcome_plan NULL.
ALTER TABLE lead_credit_events
  ADD COLUMN IF NOT EXISTS welcome_plan TEXT;

-- ── 2. Garde unique par palier welcome ─────────────────────────────────────
-- Au plus un crédit welcome par (workspace, palier). Aligné sur le
-- @@unique([workspaceId, welcomePlan]) du schema Prisma.
CREATE UNIQUE INDEX IF NOT EXISTS lead_credit_events_workspace_id_welcome_plan_key
  ON lead_credit_events (workspace_id, welcome_plan);
