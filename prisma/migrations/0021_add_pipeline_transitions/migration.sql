-- Pipeline transitions — fiche historique prospect 360° Phase 1
-- (ticket 2026-05-23-fiche-historique-prospect-360.md).
--
-- Avant : aucune trace du moment où un prospect change de stage pipeline.
-- updateOutreach / patchOutreach / reorderPipelineCards écrasaient
-- pipeline_stage sans rien sauvegarder. Impossible de répondre à "à quel
-- moment Alice est-elle passée de a_rappeler à site_demo ?" — info perdue.
--
-- Après : à chaque mutation de pipeline_stage, une row dans pipeline_transitions
-- (insertée par le hook côté queries/pipeline.ts). La timeline 360° agrège
-- transitions + followups + appointments dans /api/leads/[siren]/timeline.
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Aucun DROP, aucun
-- ALTER sur table existante. Réversible : DROP TABLE pipeline_transitions.
--
-- Référence outreach : pas de FK car outreach a une PK composite
-- (siren, tenant_id) et qu'on veut pouvoir tracer des transitions même si
-- la row outreach est supprimée (archive prospect). On stocke siren +
-- tenant_id directement et on les utilise comme clé de jointure.

CREATE TABLE IF NOT EXISTS "pipeline_transitions" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "siren"        VARCHAR(9) NOT NULL,
  "tenant_id"    UUID NOT NULL,
  "workspace_id" UUID,
  "user_id"      UUID,
  "from_stage"   VARCHAR(64),
  "to_stage"     VARCHAR(64) NOT NULL,
  "occurred_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lecture timeline d'un prospect (endpoint /api/leads/[siren]/timeline).
-- Index couvrant (siren, tenant_id, occurred_at DESC) : 99% des requêtes
-- timeline filtrent par siren+tenant puis trient desc.
CREATE INDEX IF NOT EXISTS "pipeline_transitions_siren_tenant_occurred_at_idx"
  ON "pipeline_transitions" ("siren", "tenant_id", "occurred_at" DESC);

-- Filtrage tenant pour stats / dashboards "transitions du mois".
CREATE INDEX IF NOT EXISTS "pipeline_transitions_tenant_occurred_at_idx"
  ON "pipeline_transitions" ("tenant_id", "occurred_at" DESC);

-- Filtrage workspace (visibilité scope "own" : voir uniquement les
-- transitions effectuées par les users du workspace courant).
CREATE INDEX IF NOT EXISTS "pipeline_transitions_workspace_occurred_at_idx"
  ON "pipeline_transitions" ("workspace_id", "occurred_at" DESC);
