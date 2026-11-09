-- Atlas (09/11) : IA qui ont appelé Prospection par la porte MCP du Hub, par utilisateur et client OAuth.
-- Sert à afficher « Claude branché · dernier échange » dans Atlas. Table neuve, rien n'est réécrit.
CREATE TABLE IF NOT EXISTS "atlas_presence_ia" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" TEXT NOT NULL,
  "client_nom" TEXT,
  "premier_appel" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "dernier_appel" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_presence_ia_user_id_client_id_key" ON "atlas_presence_ia"("user_id", "client_id");
