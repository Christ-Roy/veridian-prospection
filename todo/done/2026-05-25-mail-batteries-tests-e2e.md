# [PROSPECTION] Mail SMTP v1 — batteries de tests E2E + unit hardening

> **Type** : Hardening tests (mail v1 livré en prod 2026-05-25 SHA 3f927ef)
> **Sévérité** : 🟡 P1 — gate qualité avant d'accepter du trafic client réel sur le mail
> **Owner** : agent Prospection
> **Créé** : 2026-05-25
> **Demandeur** : Robert ("il faut des batteries de test")

## Contexte

Mail SMTP v1 livré commit 6b7892e (Agent Q vague 5). Sur staging puis prod 3f927ef. Mais couverture actuelle :
- 86 tests unit Vitest (crypto + smtp + queries + templates + 3 routes API)
- 0 test E2E réel (pas de Playwright qui ouvre /settings/mail, configure SMTP, envoie un mail, vérifie réception)
- 0 test contractuel avec un serveur SMTP réel (mailtrap, mailpit, ou nodemailer test account)

Avant d'accepter du trafic mail client réel (où un bug = paquet de mails ratés, contact prospect perdu), il faut **éprouver le flow complet bout en bout**.

## Périmètre

### 1. Container mailpit sur dev-pub (SMTP de test)
Mailpit = serveur SMTP local + UI qui capture les mails sans envoyer. Idéal pour tests :
- Ajouter service `mailpit` dans le compose staging dev-pub
- Port 1025 (SMTP) + 8025 (UI)
- Réseau staging-edge (accessible depuis prospection-staging + tests Playwright)

### 2. Specs E2E Playwright dans `e2e/flows-cross-app/mail-*.spec.ts`
Pattern existant (suite Agent T vague 5). 5 specs minimum :
- `mail-config-flow.spec.ts` : admin va sur /settings/mail → renseigne host=mailpit, port=1025 → "Tester la connexion" → ✓ → save → DB tenant_mail_config rempli (password chiffré)
- `mail-send-flow.spec.ts` : admin sur fiche lead → click "Envoyer mail" → modal compose → choisit template "Relance" → variables auto-remplies depuis prospect → envoie → mail apparait dans mailpit UI → row `lead_emails` créée avec sentStatus=sent
- `mail-test-connection-flow.spec.ts` : config invalide (port 9999 inaccessible) → "Tester la connexion" → erreur affichée → DB pas save
- `mail-template-rendering.spec.ts` : valide que liquid vars `{{ prospect.name }}` sont remplies correctement (pas de `{{ }}` résiduel dans le mail envoyé)
- `mail-rate-limit.spec.ts` : 11 envois en < 60s depuis même user → 10 OK + 1 retourne 429

### 3. Unit tests à renforcer
- `__tests__/lib/mail/smtp.test.ts` : tester nodemailer error cases (timeout, ECONNREFUSED, EAUTH) — assert que le shape d'erreur retournée est exploitable côté UI
- `__tests__/lib/mail/templates.test.ts` : tester escape HTML des variables liquid (XSS — si prospect.name = `<script>alert(1)</script>`, le body ne doit pas injecter)
- `__tests__/lib/crypto/encrypt-password.test.ts` : sabotage-test rotation AUTH_SECRET (ancien password déchiffré → erreur claire, pas crash silencieux)

### 4. Smoke contractuel SMTP réel
1 spec dans `e2e/staging-full/mail-real-smtp.spec.ts` qui :
- Configure SMTP avec un compte Brevo / Gmail App Password (creds dans ~/credentials/.all-creds.env)
- Envoie 1 mail à `robert.brunon+e2e-prospection@gmail.com`
- Vérifie via IMAP que le mail arrive (utilise lib `imapflow` qui sera de toute façon là pour v2)
- Skip en CI si pas de creds (graceful)

### 5. Script lancement
`scripts/e2e/mail-flows.sh` qui orchestre les specs mail contre mailpit dev-pub. Pattern de scripts/e2e/flows-cross-app.sh.

## Validation

- 5+ specs E2E mail verts contre mailpit staging
- Sabotage-test : retire le `.send()` côté smtp.ts → spec mail-send-flow rouge en <30s
- Sabotage-test : remet `{{ prospect.name }}` au lieu d'évaluer → spec mail-template-rendering rouge

## Effort

- Setup mailpit dev-pub : 1h
- 5 specs E2E : 4h
- Unit hardening (3 fichiers) : 2h
- Smoke contractuel SMTP réel : 2h
- Script + intégration : 1h
- **Total ~1.5 jour**

## Lien

- Feature mail v1 : commit 6b7892e (Agent Q)
- Pattern E2E : scripts/e2e/flows-cross-app.sh (Agent T)
- Ticket fiche 360 Phase 2 (consommateur lead_emails) : todo/2026-05-24-fiche-360-phase-2-mails.md
