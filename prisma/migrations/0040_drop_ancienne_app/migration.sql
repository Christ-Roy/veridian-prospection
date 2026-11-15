-- Base propre (Robert, 15/11/2026) : l'ancienne app (base entreprises, pipeline, mail, crédits de leads…)
-- quitte la base. Étape 2 sur 2 : le code servi ne lit plus ces tables depuis ed71da3.
-- Archive complète AVANT effacement : ~/archives/prospection-v1-20261115/prospection-complete.dump
-- (pg_dump -Fc, 576 Mo, 55 tables, sha256 identique sur le bastion et sur rise). Restaurer une table :
--   pg_restore -t <table> -d prospection prospection-complete.dump
-- Gardées : users, accounts, sessions, verification_tokens, tenants, workspaces, workspace_members,
-- sso_login_tokens, webhook_outbox, veridian_plan_history, client_errors, atlas_*.
SET statement_timeout = 0;
DROP TABLE IF EXISTS "entreprises" CASCADE;
DROP TABLE IF EXISTS "inpi_history" CASCADE;
DROP TABLE IF EXISTS "results" CASCADE;
DROP TABLE IF EXISTS "staging_master_enrich" CASCADE;
DROP TABLE IF EXISTS "staging_sirene_src" CASCADE;
DROP TABLE IF EXISTS "_backup_cm_0704" CASCADE;
DROP TABLE IF EXISTS "staging_ca_trust" CASCADE;
DROP TABLE IF EXISTS "staging_bodacc" CASCADE;
DROP TABLE IF EXISTS "claude_activity" CASCADE;
DROP TABLE IF EXISTS "workspace_pipeline_stages" CASCADE;
DROP TABLE IF EXISTS "outreach" CASCADE;
DROP TABLE IF EXISTS "appointments" CASCADE;
DROP TABLE IF EXISTS "lead_credit_events" CASCADE;
DROP TABLE IF EXISTS "followups" CASCADE;
DROP TABLE IF EXISTS "lead_consumption" CASCADE;
DROP TABLE IF EXISTS "_backup_outreach_tenant_zero_20261107" CASCADE;
DROP TABLE IF EXISTS "pipeline_transitions" CASCADE;
DROP TABLE IF EXISTS "lead_segments" CASCADE;
DROP TABLE IF EXISTS "_backup_outreach_robert_avant_fusion_20261107" CASCADE;
DROP TABLE IF EXISTS "call_log" CASCADE;
DROP TABLE IF EXISTS "mail_outbox" CASCADE;
DROP TABLE IF EXISTS "lead_orders" CASCADE;
DROP TABLE IF EXISTS "lead_emails" CASCADE;
DROP TABLE IF EXISTS "pj_leads" CASCADE;
DROP TABLE IF EXISTS "magic_links" CASCADE;
DROP TABLE IF EXISTS "segment_catalog" CASCADE;
DROP TABLE IF EXISTS "user_openrouter_link" CASCADE;
DROP TABLE IF EXISTS "tenant_mail_config" CASCADE;
DROP TABLE IF EXISTS "pipeline_config" CASCADE;
DROP TABLE IF EXISTS "tenant_mail_templates" CASCADE;
DROP TABLE IF EXISTS "ovh_monthly_destinations" CASCADE;
DROP TABLE IF EXISTS "mfa_codes" CASCADE;
DROP TABLE IF EXISTS "tenant_ai_config" CASCADE;
DROP TABLE IF EXISTS "notification_preferences" CASCADE;
DROP TABLE IF EXISTS "email_verification" CASCADE;
DROP TABLE IF EXISTS "_backup_pipeline_config_tenant_zero_20261107" CASCADE;
DROP TABLE IF EXISTS "phone_verification" CASCADE;
