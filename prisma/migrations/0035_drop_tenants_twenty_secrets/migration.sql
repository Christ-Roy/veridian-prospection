-- Secrets Twenty en clair dans tenants, que rien ne lisait (09/11) : valeurs vidées après dump au
-- froid (backups-froid/prospection-colonnes-twenty-20261109), code sans ces colonnes déjà déployé.
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "twenty_api_key";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "twenty_user_password";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "twenty_login_token";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "twenty_login_token_created_at";
