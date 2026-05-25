# [PROSPECTION] Mail improvements F/A/I/J — LIVRÉ 2026-05-25 (W9c)

> **Status** : ✅ Livré staging — commit `644c5d1`
> **Source ticket** : `todo/2026-05-25-mail-improvements-followups.md` (sections F/A/I/J)
> **Reste pending dans ticket parent** : B/C/D/E/G/H

## Périmètre livré

### F — Queue d'envoi async (`mail_outbox`)

- **Migration 0028** : table `mail_outbox` (queued → sending → sent | failed_retry | failed) + indexes (status+next_retry partial, tenant+created_at, idempotency_key UNIQUE, lead_email_id partial)
- **Lib** `src/lib/mail/outbox.ts` :
  - `enqueueMail(tx, input)` : INSERT mail_outbox + lead_emails(queued) dans MÊME transaction Prisma. Dédup sur idempotency_key (pattern Stripe — returns `alreadyEnqueued: true` si re-tenté).
  - `flushOutbox(opts)` : `SELECT FOR UPDATE SKIP LOCKED` (concurrence-safe), execute via `sendMail()` existant. DI complet pour les tests.
  - `applySignatureIfEnabled(client, tenantId, payload)` : append signature au moment du flush (vs enqueue) → toute modif de signature s'applique aux mails en queue.
  - Retry exponential : `1min → 5min → 15min → 60min → 24h` (5 tentatives, constante `MAIL_OUTBOX_MAX_ATTEMPTS=5`).
- **Cron** : `POST /api/cron/mail-outbox-flush` (auth `Bearer ${CRON_SECRET}`). À câbler Dokploy schedule `* * * * *` (1 min).
- **Refactor** `/api/mail/send` : path SMTP BYO retourne **202 queued** instantané (vs 200 sent sync). Path `gmail-via-hub` reste sync (Hub Gateway orchestre lui-même retry).
- **Lead_emails(sent_status='queued')** créé en même tx que mail_outbox → timeline 360° voit immédiatement le mail "en attente d'envoi".

### A — Templates customisables par tenant (`tenant_mail_templates`)

- **Migration 0029** : table avec `soft-delete` (deleted_at) + `UNIQUE PARTIAL (tenant_id, slug) WHERE deleted_at IS NULL` (autorise re-create après soft delete).
- **Lib** `src/lib/mail/tenant-templates.ts` :
  - `listTenantTemplates(tenantId)` : merge customs + fallbacks (customs shadow fallbacks même slug).
  - `resolveTemplate(tenantId, slug)` : custom prioritaire, fallback hardcodé sinon.
  - `createTenantTemplate` : throw `TenantTemplateConflictError` si slug conflict.
  - `updateTenantTemplate` / `softDeleteTenantTemplate`.
- **Routes admin** (RBAC `requireAdmin`) :
  - `POST /api/admin/mail-templates` (201 + audit)
  - `GET /api/admin/mail-templates`
  - `PUT /api/admin/mail-templates/[templateId]`
  - `DELETE /api/admin/mail-templates/[templateId]` (soft)
- **Route publique consumer** : `GET /api/mail/templates` (membre lit liste customs + fallbacks pour dropdown).
- **UI** : `src/components/mail/mail-templates-manager.tsx` (onglet "Templates" de `/settings/mail`).

### I — Aperçu mail avant envoi

- **Route** : `POST /api/mail/render-preview`
  - Rendu liquid simple sur subject/body avec vars `{ prospect, sender? }`
  - Détection vars non substituées → array `unresolvedVars[]` (l'UI affiche un warning)
  - Append signature optionnel (`includeSignature: true`)
  - Sender fallback sur `fromEmail`/`auth.email` si pas fourni
- **Composant** : `src/components/mail/preview-mail-dialog.tsx`
  - Iframe `sandbox="allow-same-origin"` (PAS allow-scripts → no XSS si template tiers contient `<script>`)
  - Bandeau warning si `unresolvedVars`
  - data-testid pour E2E hooks
- **Wiring** : Bouton "Aperçu" branché dans `ComposeMailDialog`.

### J — Signature commerciale auto

- **Migration 0030** : `ALTER TABLE tenant_mail_config` ADD `mail_signature_html` TEXT, `mail_signature_enabled` BOOLEAN DEFAULT true
- **Route** : `GET|PUT /api/mail/signature` (user-scope, pas admin only — c'est une signature commerciale par tenant)
- **Lib** : `updateMailSignature(tenantId, input)` ajoutée à `src/lib/mail/queries.ts`. Vue publique étendue avec `mailSignatureHtml` + `mailSignatureEnabled`.
- **UI** : `src/components/mail/mail-signature-form.tsx` (onglet "Signature" de `/settings/mail`) avec preview live via `dangerouslySetInnerHTML`.
- **Wiring** : `applySignatureIfEnabled` au flush outbox → la signature est appliquée au moment de l'envoi réel, pas à l'enqueue. Toute modif s'applique aux mails déjà en queue.

## Tests

### Unit (42 tests)

- `src/lib/mail/outbox.test.ts` : **17 tests** (retry timings, signature, DI flushOutbox complet — queue vide, send OK, fail transient, MAX-1, MAX atteint, missing creds, payload corrompu)
- `src/lib/mail/tenant-templates.test.ts` : **8 tests** (merge customs/fallbacks, resolveTemplate, conflict)
- `__tests__/api/cron/mail-outbox-flush.test.ts` : **7 tests** (auth Bearer, 503 sans secret, case-insensitive, 500 si throw)
- `__tests__/api/mail/send.test.ts` : **14 tests** (refactor 202 queued + idempotency + enqueue throw + branche Hub Gateway provider_not_linked / send OK / needs_reauth / hub_timeout → mapHubFailureToHttp)
- `__tests__/api/admin/mail-templates.test.ts` : **8 tests** (GET + POST + RBAC + rate limit + payload invalide + 409 conflict)
- `__tests__/api/admin/mail-templates/[templateId].test.ts` : **8 tests** (PUT + DELETE + 404 not found + 400 invalide)
- `__tests__/api/mail/render-preview.test.ts` : **9 tests** (rendu template + freeform + signature includeSignature + unresolvedVars)
- `__tests__/api/mail/signature.test.ts` : **10 tests** (GET + PUT + RBAC + 400 invalide + 500 DB throw)
- `__tests__/api/mail/templates.test.ts` : **3 tests** (auth + 404 + merge)
- `__tests__/components/mail/mail-signature-form.test.tsx` : **7 tests** (source-level invariants)
- `__tests__/components/mail/mail-templates-manager.test.tsx` : **9 tests** (source-level invariants)
- `__tests__/components/mail/preview-mail-dialog.test.tsx` : **7 tests** (source-level invariants, **sandbox PAS allow-scripts**)
- Extension `__tests__/lib/mail/queries.test.ts` : +3 tests (updateMailSignature + getMailConfigPublic signature fields)

**Sabotage-test : 28 ok / 0 fail.** Tous les tests modifiés détectent un sabotage `return null` du source.

### E2E hard-core (16 specs)

`e2e/staging-full/mail-improvements.spec.ts` :

- F : happy path (202 queued + row outbox + lead_emails queued), flush via cron → sent, idempotency key (2 sends même key → 1 row), retry (host unreachable → failed_retry + nextRetryAt futur), max attempts (5 fails → failed définitif)
- A : CRUD admin (create + list + update + soft-delete), conflict 409, send avec slug custom shadow fallback
- I : preview vars rendues + unresolvedVars détectées, preview avec includeSignature
- J : PUT/GET signature, send enabled → signature appendée, send disabled → pas appendée
- RBAC : non-auth /api/admin/mail-templates 401/403, /api/mail/render-preview 401/403, cron sans Bearer 401

## Coverage map ajouté

5 entries dans `test-coverage-map.yaml` avec justifications détaillées + sabotage-test scénarios.

## Reste pending dans ticket parent

`todo/2026-05-25-mail-improvements-followups.md` reste en pending pour :

- **B** — Validation DKIM/SPF (DNS lookup côté test connection)
- **C** — Quota envoi anti-spam (rolling 24h)
- **D** — Tracking ouverture/click (pixel + UTM, RGPD)
- **E** — Pièces jointes (input file + R2/S3)
- **G** — Threading conversation (In-Reply-To, dépend IMAP v2)
- **H** — Templates liquid avancé (conditions, loops, filters)

## Follow-up infra

⚠️ **`CRON_SECRET` à câbler côté staging Dokploy compose** pour activer `/api/cron/mail-outbox-flush` (sinon mails restent à `queued` indéfiniment). En prod, idem + brancher un Dokploy Schedule Job `* * * * *`.

## Référence

- Commit livraison : `644c5d1`
- Branche : `agent-w9c-mail-followups` → push direct `staging`
- CI : run `26412402153` ✅ green
- Smoke staging post-deploy : HTTP 200, db=ok, leadCount=996658
