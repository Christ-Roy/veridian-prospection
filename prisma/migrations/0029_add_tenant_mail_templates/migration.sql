-- Templates mail customisables par tenant
-- (ticket 2026-05-25-mail-improvements-followups.md §A).
--
-- Avant : 2 templates "Relance" et "Demo" hardcodés dans
-- src/lib/mail/templates.ts (Object.freeze). Pas possible d'éditer
-- depuis l'UI — chaque tenant a EXACTEMENT les mêmes textes.
--
-- Après : table tenant_mail_templates (id, tenant_id, slug, label,
-- subject, body_text, body_html, variables JSONB). Les templates
-- hardcodés deviennent des FALLBACKS si le tenant n'a rien créé ou
-- a tout supprimé — comportement strictement identique pour les
-- clients existants (regression-free).
--
-- Admin only côté UI (RBAC : "resource.update.any"). Membres consomment
-- la liste GET en lecture seule pour leur dropdown compose.
--
-- Soft delete : deleted_at nullable → on garde l'historique des
-- templates utilisés (lead_emails.template_slug stocké pour de bon).
-- UNIQUE partial sur (tenant_id, slug) WHERE deleted_at IS NULL pour
-- autoriser un re-create du même slug après soft delete.
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Réversible.

CREATE TABLE IF NOT EXISTS "tenant_mail_templates" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   UUID NOT NULL,

  -- Slug technique stable (utilisé dans lead_emails.template_slug pour
  -- l'audit). lowercase, alphanum + tirets/underscores. 64 chars.
  "slug"        VARCHAR(64) NOT NULL,

  -- Label affiché dans le dropdown UI "Choisir un template".
  "label"       VARCHAR(120) NOT NULL,

  "subject"     VARCHAR(500) NOT NULL,
  "body_text"   TEXT NOT NULL,
  "body_html"   TEXT NOT NULL,

  -- Variables liquid déclarées : tableau de noms ["prospect.name", "sender.name"]
  -- — sert à l'UI editor (auto-complétion) et à la preview pour pré-remplir.
  -- Pas une contrainte stricte : le renderer existant tolère les vars manquantes.
  "variables"   JSONB NOT NULL DEFAULT '[]',

  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at"  TIMESTAMPTZ
);

-- Unique slug par tenant — partiel sur les non-soft-deleted, pour autoriser
-- la recréation d'un slug après suppression (cas user qui supprime puis
-- recrée avec le même nom).
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_mail_templates_tenant_slug_idx"
  ON "tenant_mail_templates" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- Liste rapide par tenant (GET /api/tenants/:id/mail-templates trié par label).
CREATE INDEX IF NOT EXISTS "tenant_mail_templates_tenant_idx"
  ON "tenant_mail_templates" ("tenant_id", "deleted_at");
