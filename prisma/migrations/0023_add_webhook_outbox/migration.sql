-- Pattern transactional outbox pour webhooks app → Hub
-- (ticket 2026-05-23-emit-webhook-events-niveau2-sync-followup-outbox.md).
--
-- Avant : src/lib/hub/webhooks.ts émet en fire-and-forget. Si le process
-- Prospection crash entre la mutation DB et le fetch sortant, l'event est
-- perdu → désync silencieuse avec le Hub.
--
-- Après : les routes mutantes (soft-delete, purge, sync-member, remove-member)
-- INSERT une row webhook_outbox dans la MÊME transaction Prisma que la mutation
-- métier. Garantie d'atomicité : mutation locale ⟺ event en attente d'émission.
-- Un worker cron (/api/cron/process-outbox) consomme les rows pending et les
-- pousse au Hub avec retry exponentiel (1s → 1h, 10 attempts max).
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Aucun DROP, aucun
-- ALTER sur table existante. Réversible : DROP TABLE webhook_outbox.

CREATE TABLE IF NOT EXISTS "webhook_outbox" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type"      VARCHAR(64) NOT NULL,
  "tenant_id"       UUID NOT NULL,
  "payload"         JSONB NOT NULL,
  "idempotency_key" UUID NOT NULL,
  -- status enum text : pending → sending → sent | failed_retry → dead
  -- VARCHAR(16) + CHECK plutôt que ENUM Postgres pour ne pas générer une
  -- migration ALTER TYPE quand on ajoutera un état (pattern Veridian).
  "status"          VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK ("status" IN ('pending','sending','sent','failed_retry','dead')),
  "attempts"        INT NOT NULL DEFAULT 0,
  "next_retry_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sent_at"         TIMESTAMPTZ,
  "last_error"      TEXT
);

-- Dédup serveur — le Hub dédup déjà sur idempotency_key 24h, mais on garde
-- l'unicité côté outbox pour rejeter à l'INSERT un doublon enqueue (cas
-- replay d'une requête HMAC qui passe le anti-replay Hub mais retombe en
-- INSERT côté Prospection).
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_outbox_idempotency_key_idx"
  ON "webhook_outbox" ("idempotency_key");

-- Index principal du worker : SELECT FOR UPDATE SKIP LOCKED sur les rows
-- éligibles à un envoi (pending OR failed_retry, next_retry_at <= NOW()).
-- Tri par next_retry_at pour traiter d'abord les plus en retard.
CREATE INDEX IF NOT EXISTS "webhook_outbox_status_next_retry_idx"
  ON "webhook_outbox" ("status", "next_retry_at")
  WHERE "status" IN ('pending', 'failed_retry');

-- Index pour audit / observability : "tous les events d'un tenant", "tous
-- les dead", "tous les sent du jour". Petite table par design (rétention
-- courte), pas besoin d'index couvrants.
CREATE INDEX IF NOT EXISTS "webhook_outbox_tenant_idx"
  ON "webhook_outbox" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "webhook_outbox_status_idx"
  ON "webhook_outbox" ("status");
