-- Refill leads (ticket refill 1/3, CONTRAT-BILLING.md §8.4).
--
-- Quota de leads par workspace + historique des crédits + registre de
-- consommation. Le refill leads est un flux de revenu distinct de
-- l'abonnement : le Hub gère Stripe (Checkout one-shot) puis propage un
-- signal de crédit vers Prospection (POST /api/tenants/{id}/credit-leads).
--
-- Migration ADDITIVE — ADD COLUMN avec DEFAULT + CREATE TABLE. Aucun DROP,
-- aucun ALTER NOT NULL sur des rows existantes. Réversible.

-- ── 1. Quota sur workspaces ────────────────────────────────────────────────
-- solde = leads_credited - leads_consumed. DEFAULT 0 : les workspaces
-- existants démarrent à un solde nul (les welcome leads seront crédités via
-- l'endpoint credit-leads, ticket refill 2/3).
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS leads_credited INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_consumed INTEGER NOT NULL DEFAULT 0;

-- ── 2. Historique append-only des crédits ──────────────────────────────────
-- Une ligne = un crédit appliqué. `idempotency_key` UNIQUE = garde
-- d'idempotence : un signal Hub rejoué viole la contrainte → 200 no-op.
CREATE TABLE IF NOT EXISTS lead_credit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  quantity          INTEGER NOT NULL,
  source            TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  stripe_payment_id TEXT,
  contract_version  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_credit_events_workspace_id_created_at_idx
  ON lead_credit_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_credit_events_tenant_id_idx
  ON lead_credit_events (tenant_id);

-- ── 3. Registre de consommation (idempotent par fiche) ─────────────────────
-- Clé primaire composite (workspace_id, siren) : reconsulter la même fiche
-- ne recrée pas de ligne → le client ne paie jamais 2× la même entreprise.
CREATE TABLE IF NOT EXISTS lead_consumption (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  siren        TEXT NOT NULL,
  tenant_id    UUID NOT NULL,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, siren)
);

CREATE INDEX IF NOT EXISTS lead_consumption_tenant_id_idx
  ON lead_consumption (tenant_id);
