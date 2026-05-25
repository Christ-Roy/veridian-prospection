-- Signature commerciale auto pour les mails sortants
-- (ticket 2026-05-25-mail-improvements-followups.md §J).
--
-- Avant : aucune signature gérée — l'user doit la taper à la main dans
-- chaque body, et le template hardcodé met juste "{{ sender.name }}" en
-- fin.
--
-- Après : 2 colonnes additionnelles sur tenant_mail_config :
--   - mail_signature_html : signature rich text (HTML simple, allow-list
--     basique <p> <br> <strong> <em> <a> <img>). NULL = pas de signature.
--   - mail_signature_enabled : toggle on/off (default true si signature
--     non vide). Permet à un user de désactiver temporairement sans
--     perdre son contenu.
--
-- La signature est appendée par /api/mail/send au moment du flush outbox,
-- juste avant le sendMail() nodemailer. Pas appendée si :
--   - mail_signature_enabled = false
--   - mail_signature_html est NULL ou vide
--   - le body_html contient déjà un marqueur explicite (futur — v2)
--
-- Stockage tenant-scoped (vs user-scoped) : cohérent avec le reste du
-- model mail Veridian où tout est par tenant. v2 pourra ajouter une
-- signature par user via colonne sur `users` si besoin de différenciation
-- intra-tenant (cas agence : N commerciaux, N signatures).
--
-- Migration ADDITIVE — ALTER TABLE ADD COLUMN uniquement. Réversible.

ALTER TABLE "tenant_mail_config"
  ADD COLUMN IF NOT EXISTS "mail_signature_html" TEXT,
  ADD COLUMN IF NOT EXISTS "mail_signature_enabled" BOOLEAN NOT NULL DEFAULT true;
