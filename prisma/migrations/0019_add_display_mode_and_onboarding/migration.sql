-- Switch mode agence + onboarding ciblage (ticket 2026-05-22-switch-mode-agence-et-onboarding.md).
--
-- 4 colonnes additives sur `workspaces` pour piloter :
--   1. `display_mode` : tri global de la liste prospects.
--      - "generic" (DÉFAUT) → tri par CA / effectif (logique existante).
--      - "agency"           → tri par dette technique (web_eclate_score DESC,
--                             web_tech_score DESC).
--      Pas un filtre : la base 996K reste accessible aux 2 modes, seul
--      l'ORDER BY change côté query.
--
--   2. `default_geo_filters`    : JSON {departements: ["69", "42"]}.
--      Pré-remplit la geo-filter-sidebar au login. Modifiable à tout moment.
--
--   3. `default_sector_filters` : JSON {secteurs: ["BTP", "RESTAURATION"]}.
--      Pré-remplit la sector-sidebar. Pas un verrou.
--
--   4. `onboarding_completed_at`: NULL = parcours d'onboarding pas fait
--      (l'overlay /components/layout/onboarding.tsx s'affiche au login).
--      Datetime = fait, overlay supprimé.
--
-- Migration ADDITIVE — uniquement ALTER ADD COLUMN avec valeurs par défaut /
-- nullable. Aucun DROP, aucune contrainte sur rows existantes. Réversible :
-- ALTER TABLE workspaces DROP COLUMN display_mode, …

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "display_mode"             TEXT        NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS "default_geo_filters"      JSONB,
  ADD COLUMN IF NOT EXISTS "default_sector_filters"   JSONB,
  ADD COLUMN IF NOT EXISTS "onboarding_completed_at"  TIMESTAMPTZ;
