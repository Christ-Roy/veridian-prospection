-- Pipeline stages customisables par workspace
-- (ticket 2026-05-23-pipeline-stages-customisables-par-workspace.md)
--
-- Avant : 8 stages canoniques hardcodés côté front (src/lib/types.ts
-- PIPELINE_STAGES) + côté write (src/lib/outreach/status.ts). Le kanban
-- /pipeline et le sélecteur lead-sheet rendaient ces 8 colonnes en dur,
-- impossible à adapter par tenant — bloque la commercialisation aux
-- clients qui ont leur propre workflow (agences, verticaux B2B).
--
-- Après : table `workspace_pipeline_stages` qui décrit les colonnes du
-- kanban par workspace. Le code applicatif lit cette table au lieu de
-- la constante hardcodée. Au seed, on copie les 8 stages canoniques pour
-- chaque workspace existant — comportement strictement identique pour
-- les clients en place.
--
-- ARCHITECTURE :
--   - workspace_pipeline_stages.slug = valeur écrite dans outreach.pipeline_stage
--   - workspace_pipeline_stages.position = ordre kanban (gauche → droite)
--   - Pas de FK SQL outreach.pipeline_stage → workspace_pipeline_stages.slug
--     (les leads d'un stage soft-deleted ne doivent PAS être orphelins ;
--     l'API DELETE refuse de soft-delete un stage tant qu'il reste des
--     leads dessus, cf src/app/api/workspaces/[id]/pipeline-stages/[stageId])
--
-- Migration ADDITIVE — CREATE TABLE + INSERT SELECT. Aucun DROP, aucun
-- ALTER sur table existante. Réversible : DROP TABLE workspace_pipeline_stages.
-- Tier 🔴 HAUT par cumul (migration DB + RBAC nouvelle surface API + refonte
-- UI hot path /pipeline + /settings/pipeline).

CREATE TABLE IF NOT EXISTS "workspace_pipeline_stages" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "slug"         VARCHAR(64) NOT NULL,
  "label"        VARCHAR(80) NOT NULL,
  "position"     INTEGER NOT NULL DEFAULT 0,
  "color"        VARCHAR(32),
  "is_terminal"  BOOLEAN NOT NULL DEFAULT false,
  "is_hidden"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at"   TIMESTAMPTZ
);

-- Slug unique par workspace (cross-tenant garanti par workspace_id en clé).
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_pipeline_stages_workspace_slug_key"
  ON "workspace_pipeline_stages" ("workspace_id", "slug");

-- Lookup ordre kanban (GET /api/workspaces/[id]/pipeline-stages).
CREATE INDEX IF NOT EXISTS "workspace_pipeline_stages_workspace_position_idx"
  ON "workspace_pipeline_stages" ("workspace_id", "position");

-- Filtrage soft-delete (UI masque les rows where deleted_at IS NOT NULL).
CREATE INDEX IF NOT EXISTS "workspace_pipeline_stages_workspace_deleted_idx"
  ON "workspace_pipeline_stages" ("workspace_id", "deleted_at");

-- ============================================================================
-- SEED : pour chaque workspace existant, insérer les 8 stages canoniques
-- ============================================================================
-- ON CONFLICT DO NOTHING : si la migration est rejouée (P3005 baseline
-- pattern Veridian, cf project_prisma_migrate_pattern), on ne duplique pas.
-- Les workspaces créés APRÈS cette migration recevront leurs stages via le
-- code applicatif (helper seedDefaultPipelineStages côté API workspace create).

INSERT INTO "workspace_pipeline_stages"
  ("workspace_id", "slug", "label", "position", "color", "is_terminal", "is_hidden")
SELECT w."id", v.slug, v.label, v.position, v.color, v.is_terminal, v.is_hidden
FROM "workspaces" w
CROSS JOIN (VALUES
  ('fiche_ouverte', 'Fiche ouverte', 0, 'bg-indigo-500',  false, false),
  ('repondeur',     'Répondeur',     1, 'bg-sky-500',     false, false),
  ('a_rappeler',    'À rappeler',    2, 'bg-orange-500',  false, false),
  ('site_demo',     'Site démo',     3, 'bg-purple-500',  false, false),
  ('acompte',       'Acompte',       4, 'bg-emerald-500', false, false),
  ('finition',      'Finition',      5, 'bg-teal-500',    false, false),
  ('client',        'Client',        6, 'bg-yellow-500',  false, false),
  ('upsell',        'Upsell SaaS',   7, 'bg-rose-500',    false, false)
) AS v(slug, label, position, color, is_terminal, is_hidden)
ON CONFLICT ("workspace_id", "slug") DO NOTHING;
