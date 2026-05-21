-- CONTRAT-HUB v1.5 §3.7 — identité cross-app
-- Ajoute users.hub_user_id (nullable, unique partial) pour pointer vers
-- hub_app.users.id sans casser la PK locale `id`.
-- Backfill progressif via les endpoints provision / attach-owner / attach-member.

ALTER TABLE "users" ADD COLUMN "hub_user_id" UUID NULL;

CREATE UNIQUE INDEX "users_hub_user_id_uniq"
  ON "users"("hub_user_id")
  WHERE "hub_user_id" IS NOT NULL;
