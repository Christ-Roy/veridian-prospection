-- Add tenant_id to all operational tables for multi-tenant isolation
-- Nullable for backward compatibility with existing data

ALTER TABLE "outreach" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "claude_activity" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "followups" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "outreach_emails" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "call_log" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "lead_segments" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "pipeline_config" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "ovh_monthly_destinations" ADD COLUMN "tenant_id" UUID;

-- Indexes for query performance
CREATE INDEX "outreach_tenant_id_idx" ON "outreach"("tenant_id");
CREATE INDEX "claude_activity_tenant_id_idx" ON "claude_activity"("tenant_id");
CREATE INDEX "followups_tenant_id_idx" ON "followups"("tenant_id");
CREATE INDEX "outreach_emails_tenant_id_idx" ON "outreach_emails"("tenant_id");
CREATE INDEX "call_log_tenant_id_idx" ON "call_log"("tenant_id");
CREATE INDEX "lead_segments_tenant_id_idx" ON "lead_segments"("tenant_id");
CREATE INDEX "pipeline_config_tenant_id_idx" ON "pipeline_config"("tenant_id");
CREATE INDEX "ovh_monthly_destinations_tenant_id_idx" ON "ovh_monthly_destinations"("tenant_id");
