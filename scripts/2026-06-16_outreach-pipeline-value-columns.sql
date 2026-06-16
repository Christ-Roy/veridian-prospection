-- Colonnes outreach + entreprises ajoutées en prod par ALTER manuel mais JAMAIS
-- versionnées (ni Prisma, ni script) → absentes d'une DB recréée from-scratch.
-- Découvert le 2026-06-16 en réparant la DB staging supprimée : le code SQL brut
-- (src/lib/queries/pipeline.ts, src/components/dashboard/*) lit/écrit ces colonnes
-- → 42703 "column does not exist" → 500 sur /pipeline et la fiche prospect.
--
-- Idempotent : rejouable sans effet de bord.
-- Date : 2026-06-16

BEGIN;

-- ─── Colonnes pipeline sur outreach (valeurs deal négociées par le sales) ────
-- real_value        : valeur réelle signée (override de estimated_value)
-- upsell_estimated  : upsell estimé en cours de négociation
-- last_interaction_at : horodatage de la dernière interaction (posé à NOW() au move pipeline)
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS real_value          NUMERIC;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS upsell_estimated    NUMERIC;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMP;

-- ─── dirigeant_annee_naissance sur entreprises ──────────────────────────────
-- Le schéma INSEE/INPI porte api_dirigeant_annee_naissance ; le code applicatif
-- (src/lib/queries/shared.ts COLUMN_MAP.age_dirigeant) lit dirigeant_annee_naissance
-- sans préfixe. Colonne dérivée alimentée par l'ETL — créée ici pour la jointure code.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS dirigeant_annee_naissance TEXT;

COMMIT;
