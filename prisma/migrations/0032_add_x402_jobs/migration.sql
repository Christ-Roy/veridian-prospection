-- X402 jobs v1 — commandes longues ODH liées à une identité portefeuille.
--
-- Objectif : historiser des cartographies ODH payées/vérifiées par le core
-- x402 sans faire porter à Prospection la vérification crypto ou le paiement.
-- Le core injecte une identité wallet CAIP-10 + payment_identifier vérifiée.
-- Le wallet est l'autorité de scope ; tenant/workspace/user sont des
-- rattachements optionnels posés plus tard après SIWX/auth ou contexte
-- Veridian explicite. Tout est additif (CREATE TABLE + indexes).

CREATE TABLE IF NOT EXISTS "x402_buyers" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "workspace_id"   UUID REFERENCES "workspaces"("id") ON DELETE SET NULL,
  "wallet_account" VARCHAR(192) NOT NULL,
  "first_seen_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "x402_buyers_wallet_account_nonempty"
    CHECK (length("wallet_account") > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "x402_buyers_wallet_account_key"
  ON "x402_buyers" ("wallet_account");

CREATE INDEX IF NOT EXISTS "x402_buyers_tenant_idx"
  ON "x402_buyers" ("tenant_id");

CREATE INDEX IF NOT EXISTS "x402_buyers_wallet_idx"
  ON "x402_buyers" ("wallet_account");

CREATE TABLE IF NOT EXISTS "x402_orders" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "buyer_id"                 UUID NOT NULL REFERENCES "x402_buyers"("id") ON DELETE CASCADE,
  "tenant_id"                UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "workspace_id"             UUID REFERENCES "workspaces"("id") ON DELETE SET NULL,
  "user_id"                  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "wallet_account"           VARCHAR(192) NOT NULL,
  "job_kind"                 VARCHAR(32) NOT NULL DEFAULT 'odh_cartography',
  "status"                   VARCHAR(16) NOT NULL DEFAULT 'queued',
  "client_idempotency_key"   VARCHAR(128) NOT NULL,
  "payment_identifier"       VARCHAR(192) NOT NULL,
  "cost_asset"               VARCHAR(64) NOT NULL,
  "cost_network"             VARCHAR(64) NOT NULL,
  "cost_authorized_units"    BIGINT NOT NULL,
  "cost_settled_units"       BIGINT NOT NULL DEFAULT 0,
  "payload"                  JSONB NOT NULL,
  "payload_hash"             CHAR(64) NOT NULL,
  "queued_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "started_at"               TIMESTAMPTZ,
  "completed_at"             TIMESTAMPTZ,
  "expires_at"               TIMESTAMPTZ NOT NULL,
  "error_code"               VARCHAR(64),
  "error_message"            TEXT,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "x402_orders_status_check"
    CHECK ("status" IN ('queued','running','succeeded','failed','expired')),
  CONSTRAINT "x402_orders_job_kind_check"
    CHECK ("job_kind" IN ('odh_cartography')),
  CONSTRAINT "x402_orders_cost_units_check"
    CHECK (
      "cost_authorized_units" >= 0
      AND "cost_settled_units" >= 0
      AND "cost_settled_units" <= "cost_authorized_units"
    ),
  CONSTRAINT "x402_orders_payload_hash_check"
    CHECK ("payload_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "x402_orders_wallet_client_idempotency_key"
  ON "x402_orders" ("wallet_account", "client_idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "x402_orders_payment_identifier_key"
  ON "x402_orders" ("payment_identifier");

CREATE INDEX IF NOT EXISTS "x402_orders_tenant_created_idx"
  ON "x402_orders" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "x402_orders_wallet_created_idx"
  ON "x402_orders" ("wallet_account", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "x402_orders_tenant_status_created_idx"
  ON "x402_orders" ("tenant_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "x402_orders_expires_at_idx"
  ON "x402_orders" ("expires_at");

CREATE TABLE IF NOT EXISTS "x402_payments" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"                 UUID NOT NULL UNIQUE REFERENCES "x402_orders"("id") ON DELETE CASCADE,
  "tenant_id"                UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "wallet_account"           VARCHAR(192) NOT NULL,
  "payment_identifier"       VARCHAR(192) NOT NULL UNIQUE,
  "asset"                    VARCHAR(64) NOT NULL,
  "network"                  VARCHAR(64) NOT NULL,
  "authorized_amount_units"  BIGINT NOT NULL,
  "settled_amount_units"     BIGINT NOT NULL DEFAULT 0,
  "status"                   VARCHAR(16) NOT NULL DEFAULT 'authorized',
  "raw_payment"              JSONB,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "x402_payments_status_check"
    CHECK ("status" IN ('authorized','settled','failed','refunded')),
  CONSTRAINT "x402_payments_amount_units_check"
    CHECK (
      "authorized_amount_units" >= 0
      AND "settled_amount_units" >= 0
      AND "settled_amount_units" <= "authorized_amount_units"
    )
);

CREATE INDEX IF NOT EXISTS "x402_payments_tenant_created_idx"
  ON "x402_payments" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "x402_payments_tenant_wallet_created_idx"
  ON "x402_payments" ("tenant_id", "wallet_account", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "x402_job_results" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"          UUID NOT NULL UNIQUE REFERENCES "x402_orders"("id") ON DELETE CASCADE,
  "tenant_id"         UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "raw_result_uri"    TEXT NOT NULL,
  "raw_result_sha256" CHAR(64),
  "row_count"         INTEGER,
  "summary"           JSONB,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "x402_job_results_raw_uri_check"
    CHECK (
      "raw_result_uri" LIKE 'r2://%'
      OR "raw_result_uri" LIKE 's3://%'
      OR "raw_result_uri" LIKE 'https://%'
    ),
  CONSTRAINT "x402_job_results_sha256_check"
    CHECK ("raw_result_sha256" IS NULL OR "raw_result_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "x402_job_results_row_count_check"
    CHECK ("row_count" IS NULL OR "row_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "x402_job_results_tenant_created_idx"
  ON "x402_job_results" ("tenant_id", "created_at" DESC);
