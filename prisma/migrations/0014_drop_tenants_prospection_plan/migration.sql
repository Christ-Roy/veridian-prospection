-- Sprint C dette tech (T12) — DROP COLUMN tenants.prospection_plan
--
-- Colonne legacy Supabase. Tous les readers code ont été migrés vers
-- `tenant.plan` (commit refactor(billing) 4bc9f3a — getTenantProspectLimit ;
-- commit T13 30961af — /api/tenants/[id]/health). Le backfill historique
-- avait déjà été fait par migration 0004 (plan ← COALESCE(plan, prospection_plan))
-- mais on refait par sécurité au cas où des rows post-0004 auraient
-- échappé (audit 2026-05-21 : 1 row staging + 1 row prod avec plan IS NULL
-- et prospection_plan = 'freemium').
--
-- Idempotent via IF EXISTS sur le DROP COLUMN.

-- Backfill : recopie prospection_plan vers plan pour les rows où plan est NULL
UPDATE tenants
SET plan = COALESCE(plan, prospection_plan)
WHERE plan IS NULL AND prospection_plan IS NOT NULL;

-- Drop la colonne legacy
ALTER TABLE tenants DROP COLUMN IF EXISTS prospection_plan;
