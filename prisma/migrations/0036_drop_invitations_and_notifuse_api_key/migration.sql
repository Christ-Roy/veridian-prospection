-- Invitations locales retirées le 09/11 : une invitation crée un utilisateur, c'est le Hub.
-- Table invitations (21 lignes) et tenants.notifuse_api_key (9 lignes, vidée) dumpées au froid
-- (backups-froid/prospection-colonne-notifuse-20261109, relues, empreintes) ; code sans elles déployé avant.
DROP TABLE IF EXISTS "invitations";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "notifuse_api_key";
