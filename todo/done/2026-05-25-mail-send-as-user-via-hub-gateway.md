# [PROSPECTION] Envoi campagnes outreach depuis le Gmail du user via Hub Mail Gateway

> **Type** : Feature core — campagnes envoyées depuis le compte Gmail commercial
> **Sévérité** : 🔴 P0 — différenciateur produit (outreach = délivrabilité user, pas Veridian)
> **Owner** : agent Prospection
> **Créé** : 2026-05-25 par team-lead Hub
> **Demandeur** : Robert
> **Refs cross-app** :
> - Vision archi : `veridian-hub/todo/2026-05-25-mail-gateway-hub-multi-provider.md`
> - Implémentation Hub (en cours) : `veridian-hub/todo/2026-05-25-gmail-send-implementation-hub.md`
> - Console OAuth livré : `veridian-hub/todo/done/2026-05-25-oauth-google-gmail-client-2-setup-console.md`

---

## 0. Décision Robert

L'utilisateur Prospection doit envoyer ses campagnes **depuis son propre Gmail** (pas un sender Veridian). C'est le différenciateur produit vs Apollo/Cognism/Lusha qui forcent le sender Veridian (= ban délivrabilité instantané pour le client).

Use case Prospection : campagnes outreach 1-to-1 ou batch (max 250/jour/user en mode Gmail standard, 2000/jour si Workspace) envoyées **from = email du commercial**, reply = email du commercial, tracking délivrabilité côté user.

## 1. Frontière (cf vision Hub §4)

| Couche | Owner |
|---|---|
| OAuth Google client + scope `gmail.send` + refresh token + stockage `Account` | **Hub** (livré console + agent en cours) |
| Construction MIME + envoi via Gmail API | **Hub** (route `POST /api/mail/send-as-user`) |
| Audit `hub_app.mail_events` cross-app | **Hub** |
| UI "Connecter mon compte d'envoi" | **Prospection** (redirect vers Hub puis return) |
| Génération template + variables + appel HMAC vers Hub | **Prospection** |
| Worker batch campagne + scheduling + rate-limit local | **Prospection** |

## 2. Contrat HMAC Hub (fourni par agent Hub en cours)

### Endpoint
```
POST https://app.veridian.site/api/mail/send-as-user
```

### Auth HMAC Pattern A

```
x-veridian-app: prospection
X-Veridian-Timestamp: <epoch_ms>
X-Veridian-Hub-Signature: <hex sha256 hmac>
Content-Type: application/json
```

Secret : **`PROSPECTION_HUB_API_SECRET`** (déjà configuré, pas de nouveau secret). Signature sur `${timestamp}.${rawBody}`.

### Body Zod

```ts
{
  user_id: string,                   // hub_app.users.id du commercial qui envoie
  to: string | string[],
  subject: string,                   // 1..998 chars
  body_text?: string,
  body_html?: string,
  cc?: string[],
  bcc?: string[],
  reply_to?: string,                 // souvent l'email du commercial
  attachments?: [{ filename, content_base64, mime_type }],
  idempotency_key: string,           // UUID v4 stable par envoi
  contract_version: "1.0"
}
```

### Réponses (même table que Notifuse, cf `notifuse-veridian/todo/2026-05-25-mail-send-as-user-via-hub-gateway.md` §2)

Critique pour Prospection : **412 needs_reauth** et **422 provider_not_linked** → STOP batch + alerte UI immédiate, ne JAMAIS continuer une campagne sans compte d'envoi connecté.

## 3. Livrables Prospection

### 3.1 UI configurateur `/settings/sending-account`

Card "Compte d'envoi des campagnes" :
- **Status Gmail connecté** : affiche email du compte + bouton "Déconnecter" + bouton "Tester l'envoi"
- **Status non connecté** : bouton "Connecter mon Gmail" qui redirect vers `https://app.veridian.site/dashboard/settings/mail?return=https://prospection.app.veridian.site/settings/sending-account`
- **Status needs_reauth** : warning rouge bloquant + "Reconnecter mon Gmail"
- **Quota Gmail dispo aujourd'hui** : affiche compteur `X/250 mails envoyés aujourd'hui` (lecture via Hub `GET /api/users/{userId}/mail-quota-today` à demander Hub si pas prévu)

### 3.2 Gating campagnes

**Bloquer création/lancement campagne** si pas de compte d'envoi connecté :
- Bouton "Lancer la campagne" disabled avec tooltip "Connecte un compte d'envoi d'abord"
- Si user a déjà des campagnes scheduled mais déconnecte son Gmail → email warning + pause auto des campagnes pendant qu'il reconnecte

### 3.3 Lib `lib/mail-gateway-client.ts`

Client HMAC vers Hub (même shape que Notifuse, juste le secret diffère) :

```ts
export async function sendMailViaHub(params: {
  userId: string;
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  replyTo?: string;
  idempotencyKey: string;
}): Promise<
  | { ok: true; messageId: string; sentAt: Date; idempotentReplay?: boolean }
  | { ok: false; reason: 'needs_reauth' | 'provider_not_linked' | 'rate_limit' | 'user_not_found' | 'unreachable'; httpStatus: number }
>;
```

Idempotency key déterministe : `uuid.v5(\`${campaignId}-${recipientEmail}-${sequenceStep}\`, NAMESPACE_MAIL)` — pour qu'un retry du worker ne double-envoie jamais.

### 3.4 Refactor worker batch campagnes

Le worker actuel envoie probablement via SMTP générique (à identifier). Refactor :
- Avant chaque batch : check `user.mail_provider = 'gmail-via-hub'` ET `gmail_status = 'connected'`
- Si OK → envoie via `sendMailViaHub`
- Si KO → STOP batch + log critical + alerte UI/email user pour reconnecter
- Rate-limit local : max 250/jour/user (config Gmail standard, ou 2000/jour si Workspace — détection via metadata Account Hub)
- Tracking délivrabilité : persiste `provider_message_id` retourné par Hub pour pouvoir requêter Gmail API plus tard (bounces, opens, etc.)

### 3.5 Migration DB Prospection

Ajouter dans `workspaces` (ou `users` selon model) :
- `mail_provider TEXT DEFAULT 'none'` — `'none' | 'gmail-via-hub' | 'microsoft-via-hub' (v2)`
- `gmail_connected_at TIMESTAMPTZ` — quand l'user a connecté
- `gmail_quota_per_day INT DEFAULT 250` — calé sur la limite Gmail standard, override possible si Workspace 2000

`Existing tenants:` tous à `'none'` par défaut, comportement actuel (SMTP générique ou pas d'envoi) inchangé.

### 3.6 Tests Nuclear

- `__tests__/lib/mail-gateway-client.test.ts` (HMAC sig, codes erreur, retry, idempotency key stabilité)
- `__tests__/components/SendingAccountSettings.test.tsx` (3 états UI)
- `__tests__/workers/campaign-sender.test.ts` (gating si provider_not_linked, STOP si needs_reauth)
- `__tests__/api/workspaces/mail-provider.test.ts` (toggle + audit)

### 3.7 Tests E2E

Spec dans `e2e/staging-full/` (ou équivalent Prospection) :
- Connecter Gmail depuis Prospection staging → callback Hub → return Prospection
- Créer mini-campagne 1 destinataire (sa propre boîte) → lancer → vérifier mail reçu
- Simuler revoke refresh_token → relancer campagne → STOP propre + UI banner

## 4. Definition of done

- [ ] UI `/settings/sending-account` livrée
- [ ] Lib `mail-gateway-client.ts` + tests
- [ ] Refactor worker campagne avec gating + STOP
- [ ] Migration DB `mail_provider` + champs
- [ ] Tests Nuclear (≥25 tests cumul)
- [ ] Spec E2E (3 scenarios min)
- [ ] Push staging
- [ ] Test bout-en-bout réel : connecter Gmail depuis Prospection staging → lancer mini-campagne → recevoir mail dans sa boîte

## 5. Coordination Hub

- Attendre que `POST <hub>/api/mail/send-as-user` soit live prod (suivre `veridian-hub/todo/2026-05-25-gmail-send-implementation-hub.md`)
- Demander à Hub 2 endpoints supplémentaires si pas prévus :
  - `GET /api/users/{userId}/mail-provider-status` → `{ provider, email, needs_reauth, connected_at }`
  - `GET /api/users/{userId}/mail-quota-today` → `{ sent_today, daily_limit }`
- Si Hub refuse ces endpoints additionnels → Prospection peut tracker localement via `mail_events` qu'il insère lui-même quand il appelle `send-as-user` (moins propre mais OK)

## 6. Estimation

~8h dev cumulé (worker + UI + lib + tests + E2E).

## 7. Pré-requis avant attaque

- Le ticket Hub `2026-05-25-gmail-send-implementation-hub.md` doit être à minimum **route HMAC en staging** (étape 6 du Hub) — l'agent Prospection peut commencer la lib + UI en parallèle mais ne pourra pas tester E2E réel tant que Hub n'a pas pushé la route en staging
