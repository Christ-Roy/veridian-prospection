-- CONTRAT-HUB v1.5 §5.21 — freeze members (multi-membre tenant-level).
-- Ajoute workspace_members.frozen_at (nullable) pour activer le mode dégradé
-- paywall sur un sous-ensemble de membres d'un tenant. Index partiel pour
-- évaluer rapidement "ce user est-il actuellement freezed sur ce workspace ?".

ALTER TABLE "workspace_members" ADD COLUMN "frozen_at" TIMESTAMPTZ NULL;

CREATE INDEX "workspace_members_frozen_at_idx"
  ON "workspace_members"("frozen_at")
  WHERE "frozen_at" IS NOT NULL;
