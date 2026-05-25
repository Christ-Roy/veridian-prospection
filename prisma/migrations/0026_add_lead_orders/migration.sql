-- Migration 0026 — table `lead_orders` (ticket refill ICP page native).
--
-- Trace par achat refill leads :
--  * Quantité commandée + source ('purchase'|'welcome').
--  * Filtres ICP appliqués (filters_json) — audit + re-livraison future.
--  * Idempotency key (UNIQUE) — anti-double-credit côté Stripe webhook replay.
--  * Stripe payment intent — réconcil paiement / livraison.
--
-- Distinction vs `lead_credit_events` (déjà existante) :
--  - lead_credit_events est l'évènement BUSINESS de crédit (welcome OU achat).
--    1 row par crédit applied, source=purchase|welcome.
--  - lead_orders est la TRACE DE COMMANDE refill avec configuration ICP — un
--    sur-ensemble du subset purchase. Existe pour 2 raisons :
--      1) garder filters_json structuré (pas dispersé en metadata Stripe)
--      2) permettre une re-livraison ciblée si jamais Prospection doit re-
--         générer le lot exact (l'open-data peut bouger sur 6-12 mois).
--    Pas de FK SQL stricte sur lead_credit_events — on lie par idempotency_key
--    (string égal). Un crédit `welcome` n'aura PAS de row lead_orders.
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Réversible :
-- DROP TABLE lead_orders.

CREATE TABLE IF NOT EXISTS "lead_orders" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"     UUID NOT NULL,
  "tenant_id"        UUID NOT NULL,

  -- Quantité commandée. Doit être > 0 et ≤ MAX_LEADS_PER_REFILL_ORDER (100k).
  -- CHECK SQL pour l'invariant DB (le code Zod fait déjà le boulot mais on
  -- protège contre une mutation SQL directe).
  "quantity"         INT NOT NULL CHECK ("quantity" > 0),

  -- 'purchase' (refill Stripe one-shot) | 'welcome' (leads offerts).
  -- En pratique on n'écrit que 'purchase' ici (welcome n'a pas de config ICP).
  -- VARCHAR(16) + CHECK plutôt que ENUM Postgres (pattern Veridian — éviter
  -- une migration ALTER TYPE quand on ajoutera 'gift' ou 'compensation').
  "source"           VARCHAR(16) NOT NULL DEFAULT 'purchase'
                     CHECK ("source" IN ('purchase','welcome','gift','compensation')),

  -- Filtres ICP appliqués. JSON arbitraire, shape libre côté DB ; le code
  -- côté Prospection valide via Zod (RefillIcpFiltersSchema).
  -- NULL accepté pour les cas où l'app ne passe pas de filtres (refill
  -- "tout-venant" — backward compat avec l'ancien flow modale).
  "filters_json"     JSONB,

  -- Stripe payment intent associé. Optionnel — un crédit injecté manuellement
  -- (welcome, gift) n'aura pas de paiement Stripe.
  "stripe_payment_id" TEXT,

  -- Idempotence : 1 idempotency_key = 1 row insérée. Si le Hub rejoue
  -- (webhook Stripe replay), la 2e insert tombe en P2002 et la route
  -- credit-leads retourne 200 no-op (déjà géré par lead_credit_events).
  "idempotency_key"  TEXT NOT NULL,

  -- Version du contrat HMAC Hub→Prosp qui a produit la commande. '2.0' (legacy
  -- sans filtres) ou '2.1' (avec filters_json).
  "contract_version" VARCHAR(16),

  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotence forte : on n'insère qu'une fois par clé.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_orders_idempotency_key_key"
  ON "lead_orders" ("idempotency_key");

-- Listing par workspace, plus récent d'abord (UI "Mes commandes").
CREATE INDEX IF NOT EXISTS "idx_lead_orders_workspace_created"
  ON "lead_orders" ("workspace_id", "created_at" DESC);

-- Audit cross-tenant côté admin.
CREATE INDEX IF NOT EXISTS "idx_lead_orders_tenant"
  ON "lead_orders" ("tenant_id");

-- Réconcil Stripe ↔ commande quand on cherche par payment_intent.
CREATE INDEX IF NOT EXISTS "idx_lead_orders_stripe_payment"
  ON "lead_orders" ("stripe_payment_id")
  WHERE "stripe_payment_id" IS NOT NULL;
