-- Client-side JS errors persistence (ticket 2026-05-23-persist-client-errors-db.md).
--
-- Avant : POST /api/errors faisait `console.error()`. Les erreurs partaient en
-- stdout container Docker, archivées par la rotation Docker, impossibles à
-- requêter ("ce TypeError s'est-il reproduit après le fix d5ae9e8 ?" sans
-- réponse opérationnelle). Trou observability identifié par bug-intermittent.
--
-- Après : INSERT avec dédupe par (dedupeKey, heure d'occurrence). Une
-- nouvelle occurrence d'une erreur déjà vue dans l'heure courante incrémente
-- `count` au lieu d'ajouter une row → table bornée même en crash loop.
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Aucun DROP, aucun
-- ALTER sur table existante. Réversible : DROP TABLE client_errors.

CREATE TABLE IF NOT EXISTS "client_errors" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     UUID,
  "workspace_id"  UUID,
  "user_id"       UUID,
  "message"       TEXT NOT NULL,
  "stack"         TEXT,
  "url"           TEXT,
  "user_agent"    TEXT,
  "dedupe_key"    TEXT NOT NULL,
  "occurred_hour" TIMESTAMPTZ NOT NULL,
  "occurred_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "count"         INTEGER NOT NULL DEFAULT 1
);

-- Garde unique : une row par (dedupeKey, heure d'occurrence). Le code route
-- fait un upsert sur cette clé + INCREMENT count.
CREATE UNIQUE INDEX IF NOT EXISTS "client_errors_dedupe_hour_key"
  ON "client_errors" ("dedupe_key", "occurred_hour");

-- Liste chronologique récente (endpoint admin GET /api/admin/client-errors).
CREATE INDEX IF NOT EXISTS "client_errors_occurred_at_idx"
  ON "client_errors" ("occurred_at" DESC);

-- Filtrage par tenant (si on veut un jour exposer aux admins de tenant).
CREATE INDEX IF NOT EXISTS "client_errors_tenant_id_occurred_at_idx"
  ON "client_errors" ("tenant_id", "occurred_at" DESC);
