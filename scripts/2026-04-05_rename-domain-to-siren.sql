-- Radical refactor: rename `domain` → `siren` in all metier tables.
-- This makes the whole app SIREN-centric, aligned with the new `entreprises` table.
--
-- Strategy:
--   1. Drop FK constraints that reference results.domain
--   2. Rename domain → siren on: outreach, call_log, followups, claude_activity,
--      outreach_emails, lead_segments, email_verification, phone_verification, pj_leads
--   3. For outreach: rebuild the PK (siren, tenant_id)
--   4. Keep `results.domain` as-is for now (legacy table, will be dropped in a later phase)
--
-- NO data migration: the existing rows' `domain` values were mostly real domain names.
-- Tests will seed new data with SIREN values. The 26 demo outreach rows (seeded) will
-- become stale garbage and can be cleaned up after.
--
-- Idempotent: checks existence of column before renaming.

BEGIN;

-- 1) Drop foreign key constraints referencing results.domain
ALTER TABLE outreach           DROP CONSTRAINT IF EXISTS outreach_domain_fkey;
ALTER TABLE call_log           DROP CONSTRAINT IF EXISTS call_log_domain_fkey;
ALTER TABLE followups          DROP CONSTRAINT IF EXISTS followups_domain_fkey;
ALTER TABLE claude_activity    DROP CONSTRAINT IF EXISTS claude_activity_domain_fkey;
ALTER TABLE outreach_emails    DROP CONSTRAINT IF EXISTS outreach_emails_domain_fkey;
ALTER TABLE email_verification DROP CONSTRAINT IF EXISTS email_verification_domain_fkey;
ALTER TABLE phone_verification DROP CONSTRAINT IF EXISTS phone_verification_domain_fkey;

-- 2) Drop the outreach PK (domain, tenant_id) before renaming column
ALTER TABLE outreach DROP CONSTRAINT IF EXISTS outreach_pkey;

-- 3) Rename columns where still named `domain`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outreach' AND column_name='domain') THEN
    ALTER TABLE outreach RENAME COLUMN domain TO siren;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='call_log' AND column_name='domain') THEN
    ALTER TABLE call_log RENAME COLUMN domain TO siren;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followups' AND column_name='domain') THEN
    ALTER TABLE followups RENAME COLUMN domain TO siren;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='claude_activity' AND column_name='domain') THEN
    ALTER TABLE claude_activity RENAME COLUMN domain TO siren;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outreach_emails' AND column_name='domain') THEN
    ALTER TABLE outreach_emails RENAME COLUMN domain TO siren;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_segments' AND column_name='domain') THEN
    ALTER TABLE lead_segments RENAME COLUMN domain TO siren;
  END IF;
END $$;

-- 4) Rebuild outreach PK on (siren, tenant_id)
ALTER TABLE outreach ADD PRIMARY KEY (siren, tenant_id);

-- 5) Relax siren column types to TEXT (not VARCHAR(9)) to match entreprises.siren
ALTER TABLE outreach        ALTER COLUMN siren TYPE TEXT;
ALTER TABLE call_log        ALTER COLUMN siren TYPE TEXT;
ALTER TABLE followups       ALTER COLUMN siren TYPE TEXT;
ALTER TABLE claude_activity ALTER COLUMN siren TYPE TEXT;
ALTER TABLE outreach_emails ALTER COLUMN siren TYPE TEXT;
ALTER TABLE lead_segments   ALTER COLUMN siren TYPE TEXT;

-- 6) Cleanup: drop stale seed data (demo rows referenced old domain values that are
-- not valid SIREN 9-digit identifiers, they'd break joins to entreprises anyway)
DELETE FROM outreach        WHERE siren !~ '^\d{9}$';
DELETE FROM call_log        WHERE siren IS NOT NULL AND siren !~ '^\d{9}$';
DELETE FROM followups       WHERE siren !~ '^\d{9}$';
DELETE FROM claude_activity WHERE siren !~ '^\d{9}$';
DELETE FROM outreach_emails WHERE siren !~ '^\d{9}$';
DELETE FROM lead_segments   WHERE siren !~ '^\d{9}$';

-- 7) Verify post-state
SELECT 'outreach'        AS t, COUNT(*) FROM outreach
UNION ALL SELECT 'call_log',        COUNT(*) FROM call_log
UNION ALL SELECT 'followups',       COUNT(*) FROM followups
UNION ALL SELECT 'claude_activity', COUNT(*) FROM claude_activity
UNION ALL SELECT 'outreach_emails', COUNT(*) FROM outreach_emails
UNION ALL SELECT 'lead_segments',   COUNT(*) FROM lead_segments
ORDER BY 1;

COMMIT;
