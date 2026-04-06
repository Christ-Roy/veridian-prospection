-- Migration 0003: Composite PKs for multi-tenant isolation
-- Tables: outreach, pipeline_config, lead_segments
-- Makes tenant_id part of the PK so different tenants can operate on the same leads

-- Step 1: Set NULL tenant_id to default UUID for existing rows
UPDATE outreach SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE pipeline_config SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE lead_segments SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;

-- Step 2: Make tenant_id NOT NULL with default
ALTER TABLE outreach ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE outreach ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE pipeline_config ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pipeline_config ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE lead_segments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE lead_segments ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- Step 3: Drop old PKs
ALTER TABLE outreach DROP CONSTRAINT outreach_pkey;
ALTER TABLE pipeline_config DROP CONSTRAINT pipeline_config_pkey;
ALTER TABLE lead_segments DROP CONSTRAINT lead_segments_pkey;

-- Step 4: Create composite PKs
ALTER TABLE outreach ADD PRIMARY KEY (domain, tenant_id);
ALTER TABLE pipeline_config ADD PRIMARY KEY (key, tenant_id);
ALTER TABLE lead_segments ADD PRIMARY KEY (domain, segment, tenant_id);

-- Step 5: Drop old tenant_id indexes (now part of PK)
DROP INDEX IF EXISTS outreach_tenant_id_idx;
DROP INDEX IF EXISTS pipeline_config_tenant_id_idx;
DROP INDEX IF EXISTS lead_segments_tenant_id_idx;
