-- Migration 2026-05-08 : Migration de la table tenants depuis Supabase vers Postgres prospection.
-- En prod, la table existe déjà (créée par le Hub via provisioning). On la déclare juste à Prisma.
-- Idempotent : CREATE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending',
  "prospection_plan" TEXT DEFAULT 'freemium',
  "trial_ends_at" TIMESTAMPTZ,
  "metadata" JSONB,
  "provisioned_at" TIMESTAMPTZ,
  "last_activity_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prospection_plan" TEXT DEFAULT 'freemium';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX IF NOT EXISTS "tenants_user_id_idx" ON "tenants"("user_id");
CREATE INDEX IF NOT EXISTS "tenants_deleted_at_idx" ON "tenants"("deleted_at");
