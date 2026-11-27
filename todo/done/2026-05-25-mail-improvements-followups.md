# [PROSPECTION] Mail SMTP v1 — améliorations & follow-ups identifiés

> **Type** : Roadmap d'améliorations post-livraison mail v1
> **Sévérité** : 🟢 P2 (chaque item est indépendant)
> **Owner** : agent Prospection
> **Créé** : 2026-05-25

## Contexte

Mail v1 livré (commit 6b7892e + migration 0022). Liste des améliorations identifiées au cours de l'audit post-livraison, à dégainer selon priorité business :

## Améliorations

### A — Templates customisables par tenant (au lieu de 2 hardcodés) ✅ LIVRÉ 2026-05-25 (W9c)
- Livré : migration 0029 + `tenant_mail_templates` + `src/lib/mail/tenant-templates.ts` + routes `/api/admin/mail-templates[/templateId]` + `/api/mail/templates` (consumer) + UI `MailTemplatesManager` dans `/settings/mail` (onglet Templates)
- Fallback hardcodés préservés pour les tenants qui n'ont rien créé — UNIQUE PARTIAL (tenant, slug) WHERE deleted_at IS NULL pour autoriser re-create
- Tests : unit + 3 specs E2E (CRUD, conflict 409, send avec slug custom)

### B — Validation DKIM / SPF du from_email
- Au moment du "Tester la connexion", lookup DNS du domaine `smtpFromEmail`
- Si SPF/DKIM/DMARC manquant → warning UI (le mail risque le spam)
- Lib : `dns.promises` Node natif
- Effort : ~3h

### C — Quota envoi (anti-spam interne)
- Soft limit : 100 mails / jour / tenant freemium, 1000 / pro, illimité business
- Table `mail_send_quotas` (rolling 24h)
- 429 si dépassé + reset après 24h
- Effort : ~4h

### D — Tracking ouverture / click (pixel + UTM)
- Pixel transparent dans body_html avec id signé → endpoint `/api/mail/track-open?id=XXX`
- UTM auto sur tous les liens dans body
- Visible dans timeline 360° du prospect (event `mail_opened`, `mail_clicked`)
- ⚠️ Question RGPD : opt-in tracking ? Probable oui (cohérent avec stratégie Veridian "client paie, contrôle tout")
- Effort : ~1 jour

### E — Pièces jointes
- v1 = pas de pièce jointe
- Cible : input file dans modal compose, upload vers R2/S3, lien dans body OU attachement nodemailer
- Limite : 10 MB par mail (anti-bounce serveur destinataire)
- Effort : ~6h

### F — Queue d'envoi avec retry (background worker) ✅ LIVRÉ 2026-05-25 (W9c)
- Livré : migration 0028 + `mail_outbox` + `src/lib/mail/outbox.ts` (enqueue + flush SELECT FOR UPDATE SKIP LOCKED) + route `/api/cron/mail-outbox-flush` (Bearer CRON_SECRET, 1 min) + refactor `/api/mail/send` (path SMTP BYO retourne 202 queued, branche Hub Gateway reste sync)
- Retry exponential : 1min → 5min → 15min → 60min → 24h (5 tentatives) puis `failed`
- Idempotency_key UNIQUE + dédup explicite pré-INSERT (pattern Stripe)
- `lead_emails(sent_status='queued')` créé dans la même tx que mail_outbox → timeline 360° voit immédiatement le mail pending
- Tests : 17 unit (outbox.ts) + 7 unit (cron) + 5 specs E2E (happy path, flush, idempotency, retry, max attempts)

### G — Threading conversation (Reply-To + In-Reply-To)
- Quand on répond à un mail entrant (v2 IMAP), le `In-Reply-To` doit être posé
- Le `Message-ID` outgoing doit être généré côté Veridian (format `<uuid@prospection.app.veridian.site>`)
- Threading visible dans timeline 360°
- Dépend de v2 IMAP — bloqué jusque-là
- Effort : ~4h (post IMAP)

### H — Templates LangChain / variables avancées
- Au-delà des `{{ prospect.name }}` plats : conditions (`{% if prospect.has_https %}`), loops (`{% for c in contacts %}`), helpers (`{{ prospect.ca | currency_fr }}`)
- Lib : `liquidjs` (déjà installé pour les templates Notifuse)
- Effort : ~3h

### I — Aperçu mail avant envoi ✅ LIVRÉ 2026-05-25 (W9c)
- Livré : route `POST /api/mail/render-preview` (rendu liquid + détection vars non substituées + signature optionnelle) + composant `PreviewMailDialog` (iframe sandbox="allow-same-origin") branché dans `ComposeMailDialog` (bouton "Aperçu")
- Tests : 2 specs E2E (variables + signature includeSignature)

### J — Signature commerciale auto ✅ LIVRÉ 2026-05-25 (W9c)
- Livré : migration 0030 (colonnes `mail_signature_html` + `mail_signature_enabled` sur `tenant_mail_config`) + route `/api/mail/signature` (GET/PUT) + composant `MailSignatureForm` (onglet Signature dans `/settings/mail`) + `applySignatureIfEnabled` au flush outbox (read tenant_mail_config, append HTML + plain text)
- Signature appliquée au moment du flush (vs enqueue) → toute modif s'applique aux mails en queue
- Tests : 6 unit (applySignatureIfEnabled) + 3 specs E2E (PUT/GET, enabled, disabled)
- v2 possible : variables `{{ user.full_name }}` / `{{ user.phone }}` (out of scope pour v1, peut être ajouté quand le besoin émerge)

## Ordre suggéré (priorité commerciale)

1. **F** Queue envoi (UX instantanée) → indispensable dès qu'on dépasse 10 mails/jour
2. **A** Templates customisables → différenciation immédiate
3. **I** Aperçu → safety net contre le mail avec `{{ var }}` brisé
4. **J** Signature auto → propreté commerciale
5. **B** Validation DKIM → réduit le spam (vrai problème client)
6. **H** Liquid avancé → puissance template
7. **C** Quota anti-spam → couvre la commercialisation
8. **D** Tracking → bonus argument vente
9. **E** Pièces jointes → demande client probable
10. **G** Threading → après IMAP v2

## Coordination

Indépendant. Aucun chantier ne touche au Hub. Chaque amélioration peut être livrée en vague isolée.

## Référence

- Mail v1 : commit 6b7892e
- Lien IA templates : `todo/2026-05-25-mail-templates-ia-llm.md` (vague 6)
- Lien batteries tests : `todo/2026-05-25-mail-batteries-tests-e2e.md` (vague 6)
