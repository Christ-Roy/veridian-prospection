-- Le Hub remet une poignée PAR ORGANISATION (VER-245 b.2) : la clé d'une poignée est (session, organisation).
DELETE FROM "session_delegations" WHERE "hub_tenant_id" IS NULL;
ALTER TABLE "session_delegations" ALTER COLUMN "hub_tenant_id" SET NOT NULL;
ALTER TABLE "session_delegations" DROP CONSTRAINT IF EXISTS "session_delegations_pkey";
ALTER TABLE "session_delegations" ADD CONSTRAINT "session_delegations_pkey" PRIMARY KEY ("session_id", "hub_tenant_id");
