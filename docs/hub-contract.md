# Hub contract — implémentation côté Prospection

> **Source de vérité absolue** :
> - `veridian-platform/CONTRAT-HUB.md` v1.4 (vision + invariants, 3443L)
> - `veridian-platform/CONTRAT-HUB-API-REF.md` v1.0 (référence technique, 1277L)
>
> Les 2 sont symlinkés depuis `veridian-hub/docs/`. Ce document décrit
> **comment Prospection implémente** ses obligations contractuelles, avec
> les pièges et chemins de code spécifiques.
>
> **Dernière sync avec le contrat** : 2026-05-21 (v1.4).
> **Ticket de conformité actif** : `todo/2026-05-19-hub-contract-conformity.md`.

---

## Score conformité au 2026-05-21

**13/22 endpoints livrés (59 %)** + socle solide + lifecycle complet + auth HMAC complet.

Voir `CONTRAT-HUB.md` §10.1 pour la matrice exhaustive cross-app.

| Domaine | État | Détail |
|---|---|---|
| Auth HMAC + Bearer | ✅ 100 % | `src/lib/hub/hmac.ts` + 19 tests |
| Endpoints §5.1-5.8 (socle + lifecycle) | ✅ 11/11 | Tous livrés 2026-05-19 |
| Webhooks app→Hub | 🟡 3/8 | suspended/resumed/deleted ✅ ; touched/owner_changed/quota/member ❌ |
| Plans SaaS (7/7) | ✅ 100 % | `src/lib/plans.ts` + immunité `plan_source` |
| Mode paywall §5.9 | ✅ | obfuscation serveur 33%+bullets + `<Paywall>` + `<BlurredText>` |
| Format erreurs §5.10 | ✅ | codes standardisés alignés API-REF |
| Idempotency-Key §5.11 | 🟡 50 % | webhooks oui, endpoints directs non |
| §5.18 sync-member | ❌ | ticket `2026-05-19-v13-multi-membre-cross-app.md` |
| §5.19 remove-member | ❌ | idem |
| §5.20 restore-member | ❌ | idem |
| §5.21 freeze/unfreeze | ❌ | idem |
| §5.22 attach-member (P1 NEW) | ❌ | ticket `2026-05-21-hub-attach-member-endpoint.md` |
| §3.7 identité hub_user_id | ❌ | migration à câbler (colonne `users.hub_user_id` nullable) |

---

## §1.4 Résilience Hub-down — comment Prospection survit

Conformément à `CONTRAT-HUB.md` §1.4 (gravé v1.4) :

- **Lookup plan** : 100 % local via `tenants.plan` + cache implicite Prisma.
  Pas de call Hub au runtime. Hub push les changements via §5.2 `update-plan`.
- **Lookup membre** : 100 % local via `workspace_members`. Hub ne sait rien
  des memberships internes (Prospection a N workspaces par tenant, Hub n'a
  que la vue tenant-level).
- **Magic link déjà émis** : `magic_links` table locale (token signé), pas
  de vérif Hub au consume.
- **API key tenant** : `workspaces.api_key_hash` local, comparé via SHA256.

**Effet pratique** : si `hub.veridian.site` tombe, Prospection continue de
servir tous les users déjà loggés + tous ceux qui ont un magic link valide.
Seules les **nouvelles invitations** et le **provisioning de nouveaux
tenants** sont bloqués (logique : ces actions partent du Hub).

---

## §3.7 Modèle d'identité user cross-app (à implémenter)

**État actuel** : `users.id` Prospection = UUID v4 local. Aucune colonne
`hub_user_id`.

**Cible v1.4** :

1. Migration Prisma additive :
   ```prisma
   model User {
     id          String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
     email       String @unique
     hubUserId   String? @unique @map("hub_user_id") @db.Uuid  // NEW
     // ... reste inchangé
   }
   ```
2. Backfill au premier appel HMAC qui mentionne `hub_user_id` (provision,
   sync-member, attach-member, update-plan) :
   ```sql
   UPDATE users SET hub_user_id = $1
   WHERE id = (SELECT id FROM users WHERE email = $2 LIMIT 1)
     AND hub_user_id IS NULL;
   ```
3. **Pas de migration destructive** : `users.id` reste PK, `hub_user_id`
   est colonne secondaire indexée. Tous les FK existants (`workspace_members.user_id`,
   `tenants.user_id`) continuent de pointer vers `users.id`.

**Implémentation** : tracker dans le ticket `2026-05-21-hub-attach-member-endpoint.md`
(c'est lui qui touchera en premier la table users via résolution cross-app).

---

## §6.1 — Authentification HMAC Hub (livré)

### Format canonique

Headers attendus côté Prospection :

```
X-Veridian-Timestamp: <unix_ms>
X-Veridian-Hub-Signature: <hex(hmac_sha256(secret, "${timestamp}.${raw_body}"))>
Content-Type: application/json
```

Le secret partagé est `HUB_API_SECRET` (env Prospection). Côté Hub :
`PROSPECTION_HUB_API_SECRET` (cf `CONTRAT-HUB.md` §6.5).

Vérification dans `src/lib/hub/hmac.ts:verifyHubHmac` :

1. Drift timestamp < 5min (`HUB_TIMESTAMP_DRIFT_MS`)
2. Recompute `hmac_sha256(secret, ts + "." + rawBody)`
3. Comparaison **temps constant** (`crypto.timingSafeEqual`)

### Curl reproductible (smoke staging)

```bash
SECRET="$HUB_API_SECRET"
HOST="https://prospection.staging.veridian.site"
TS=$(date +%s%3N)
BODY='{"email":"smoke@yopmail.com","plan":"freemium"}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

curl -sSf -X POST "$HOST/api/tenants/provision" \
  -H "Content-Type: application/json" \
  -H "X-Veridian-Timestamp: $TS" \
  -H "X-Veridian-Hub-Signature: $SIG" \
  -d "$BODY" | jq .
```

Doit retourner 200 + `tenant_id`, `api_key`, `login_url`, `plan`, `created: true`.

### Compatibilité legacy (fenêtre de migration 30j)

Pendant la migration coordonnée avec l'agent Hub :

| Mode | Activé par | Format |
|---|---|---|
| `legacy_email_ts` | `ACCEPT_LEGACY_HMAC=1` (default) | `{ timestamp, signature: hmac(secret, "${email}:${ts}") }` dans le body |
| `legacy_bearer` | `ACCEPT_LEGACY_BEARER=1` (default) | `Authorization: Bearer <secret>` |

**Plan de coupure** : 30j après que l'agent Hub aura migré son client
`prospection` vers le format standard. Coupure = poser les 2 flags à `0`
dans Dokploy env vars.

### Sécurité

- `verifyHubHmac` valide les inputs avant compute : pas de NaN timestamp,
  pas de signature vide, longueur hex doit matcher avant `timingSafeEqual`.
- Catch sur exception Buffer → fallback `invalid_signature`. Pas de leak.
- Log warning explicite quand un legacy est accepté pour observabilité.

### Tests

- `src/lib/hub/hmac.test.ts` : 19 tests unitaires (signature correcte/incorrecte,
  drift, secret manquant, body modifié, secret rotaté, formats invalides).
- `__tests__/api/tenants/provision.test.ts` : 11 tests handler dont 4 dédiés
  au pattern A standard (body signé, body tampered, drift, signature bad).

---

## §6.2 — Bearer api_key tenant (livré)

Pour `POST /api/workspaces.generateMagicLink`. Voir helper `extractBearerApiKey`
dans `src/lib/hub/hmac.ts`. Une `api_key` = un workspace, jamais partagée —
l'app détecte le partage et retourne 409.

Routes utilisant ce pattern :
- `src/app/api/workspaces.generateMagicLink/route.ts`

---

## §6.3 — Bearer Hub webhook token (partiel)

Pour les webhooks app→Hub. Token statique `HUB_WEBHOOK_TOKEN` côté Prospection,
`PROSPECTION_WEBHOOK_TOKEN` côté Hub.

État : code câblé dans `src/lib/hub/webhooks.ts` mais env var pas encore
provisionnée côté Hub. **À fixer** : créer `PROSPECTION_WEBHOOK_TOKEN` dans
`~/credentials/.all-creds.env` + GitHub Secrets veridian-hub + Dokploy ENV
Hub prod + Dokploy ENV staging.

---

## §5.22 — Endpoint attach-member workspace-level (À LIVRER)

> 🔥 P1 bloqueur — `veridian-hub/lib/invitations/accept.ts:112` attend cet endpoint.

### Spec

**Route** : `POST /api/veridian/workspaces/[workspaceId]/attach-member`

**Auth** : HMAC Pattern A (réutilise `verifyHubHmac`).

**Body** :
```json
{
  "hub_user_id": "string",
  "hub_user_email": "string",
  "role": "owner | admin | member | viewer",
  "invitation_id": "string (audit)"
}
```

**Response 201 (créé)** / **200 (idempotent)** :
```json
{
  "attached": true,
  "already_member": false,
  "member_id": "string (workspace_members.user_id)",
  "workspace_id": "string (echo)",
  "role": "string (LOCAL — JAMAIS écrasé si déjà membre, cf §5.22.4)",
  "login_url": "string (magic link Prospection auto-login, TTL 60s)"
}
```

### Comportement obligatoire

1. **HMAC verify** → 401 si invalide / drift > 5min
2. **Lookup workspace** :
   - `workspaces.id = workspaceId AND deleted_at IS NULL` → use it
   - Pas trouvé → 404 `workspace_not_found`
   - Soft deleted → 410 `workspace_gone`
   - Tenant en suspended → 423 `workspace_suspended`
3. **Résolution user** (cf §3.7) :
   - `users.hub_user_id = hub_user_id` → use it
   - Sinon `users.email = hub_user_email` → backfill `hub_user_id` + use
   - Sinon crée user local : password=NULL, email_verified=NULL,
     hub_user_id rempli, email rempli
4. **Lookup workspace_members(workspace_id, user_id)** :
   - Trouvé, role identique → 200 `already_member=true`
   - Trouvé, role différent → 200 `already_member=true`, role LOCAL préservé,
     log info "role conflict ignored: local=X requested=Y"
   - Pas trouvé → INSERT `workspace_members { workspace_id, user_id, role, visibility_scope='all', joined_at: now() }` + 201
5. **Audit log** :
   ```typescript
   await prisma.auditLog.create({
     data: {
       tenantId: workspace.tenantId,
       actorType: 'hub',
       action: 'workspace.member.attached_via_hub',
       targetType: 'user',
       targetId: user.id,
       metadata: { hub_user_id, invitation_id, role, already_member }
     }
   });
   ```
6. **Génération login_url** :
   - Créer `MagicLink { token, email, tenantId, workspaceId, role, expires_at: now+60s }`
   - Retourner `https://prospection.app.veridian.site/?token=<token>`

### Notes Prospection

- **N workspaces par tenant** : c'est tout l'intérêt de l'endpoint workspace-level.
  Le Hub doit choisir le workspace cible (vient de l'invitation `target_workspace_id`).
- **Visibility scope** : défaut `'all'` (l'invité voit tous les prospects du
  workspace). L'admin Prospection peut downgrade à `'own'` via UI ensuite.
- **Membre déjà élevé localement** : si alice est `admin` et le Hub renvoie
  `role=member`, on garde `admin`. C'est la règle §5.22.4 — admin Prospection
  garde le contrôle souverain.

### Tests obligatoires

- HMAC valide → 201 + workspace_members créé + audit_log créé
- HMAC invalide → 401, AUCUNE row créée
- Drift > 5min → 401
- Workspace inconnu (après HMAC OK) → 404
- Workspace soft_deleted → 410
- Tenant suspended → 423
- Replay même params → 200 `already_member=true`
- Replay role différent → 200 `already_member=true`, role local préservé, log info
- User legacy par email (sans hub_user_id) → backfill OK + 201

---

## §5.18 — Sync-member tenant-level (À LIVRER)

**Route** : `POST /api/tenants/[tenantId]/sync-member`

**Différence avec §5.22 attach-member** :
- `sync-member` ajoute au **workspace par défaut** du tenant (créé si absent)
- `attach-member` ajoute à un **workspace précis** (workspace_id donné)

Spec complète dans `CONTRAT-HUB-API-REF.md` section SYNC.

**Notes Prospection** :
- "Workspace par défaut" = le premier workspace créé pour ce tenant (ORDER BY created_at ASC LIMIT 1)
- Si aucun workspace → créer un workspace `default` puis ajouter le user

---

## §5.19 / §5.20 / §5.21 — Remove / restore / freeze members (À LIVRER)

Spec dans `CONTRAT-HUB-API-REF.md` sections RM, RESTM, FREEZE, UNFREEZE.

**Notes Prospection** :
- `remove-member` : soft delete sur **toutes** les `workspace_members` du
  user pour ce tenant (le user peut être dans plusieurs workspaces du même
  tenant — on retire de tous).
- Refuser le owner du tenant → 409 `cannot_remove_owner`
- `freeze-members` : activer le paywall obfusqué uniquement pour les users
  listés (pas tout le workspace). Pattern existant `<Paywall>` + serveur
  obfusqué dans `/api/leads/[domain]/route.ts`.

---

## Variables d'environnement

| Var | Rôle | Source |
|---|---|---|
| `HUB_API_SECRET` | Secret HMAC partagé Hub/Prospection | Dokploy ENV (prod) + `.env.staging` (staging) |
| `TENANT_API_SECRET` | Alias historique de `HUB_API_SECRET` (lu en fallback) | idem |
| `HUB_WEBHOOK_TOKEN` | Token Bearer pour webhooks app→Hub | À provisionner côté Hub |
| `ACCEPT_LEGACY_HMAC` | `1`=on (default) / `0`=off | À set `0` après coupure 30j |
| `ACCEPT_LEGACY_BEARER` | `1`=on (default) / `0`=off | À set `0` après coupure 30j |
| `HUB_TIMESTAMP_DRIFT_MS` | Drift max (default 300000 = 5min) | rarement override |

---

## Chemins clés du code Prospection

```
src/lib/hub/
├── hmac.ts                       Pattern A + B + extract bearer + legacy compat
├── apiKey.ts                     Generation + hashing (SHA256)
└── webhooks.ts                   Émission webhooks app→Hub avec retry

src/app/api/tenants/
├── provision/route.ts            §5.1 ✅
├── update-plan/route.ts          §5.2 ✅
├── attach-owner/route.ts         §5.3 ✅
├── suspend/route.ts              §5.4 ✅
├── resume/route.ts               §5.4 ✅
├── [id]/health/route.ts          §5.5 ✅
├── [id]/soft-delete/route.ts     §5.8.1 ✅
├── [id]/restore/route.ts         §5.8.2 ✅
├── [id]/purge/route.ts           §5.8.3 ✅
└── [id]/usage-summary/route.ts   §5.8.5 ✅

src/app/api/workspaces.generateMagicLink/route.ts   §5.6 ✅

À CRÉER :
src/app/api/veridian/workspaces/[workspaceId]/attach-member/route.ts   §5.22 NEW
src/app/api/tenants/[id]/sync-member/route.ts                          §5.18.3
src/app/api/tenants/[id]/remove-member/route.ts                        §5.19.2
src/app/api/tenants/[id]/restore-member/route.ts                       §5.20
src/app/api/tenants/[id]/freeze-members/route.ts                       §5.21
src/app/api/tenants/[id]/unfreeze-members/route.ts                     §5.21
src/app/api/users/by-email/route.ts                                    §5.12 discovery
```

---

## Tickets actifs liés au contrat

- `todo/2026-05-19-hub-contract-conformity.md` — ticket racine, conformité v1.2 (Phase 1-6 ✅)
- `todo/2026-05-19-hub-contract-phase1-suite.md` — smoke prod + ENV Dokploy
- `todo/2026-05-19-v13-multi-membre-cross-app.md` — §5.18-5.21 multi-membre
- `todo/2026-05-21-hub-attach-member-endpoint.md` — §5.22 P1 invitation (PRIORITÉ)
- `todo/2026-05-20-dette-tech-db-destructive-sprints.md` — DROP destructifs (tier 💀)

---

## Convention de maintenance de ce doc

- Mettre à jour à chaque livraison d'un endpoint contractuel
- Bumper la "Dernière sync" en tête quand on aligne sur une nouvelle version du contrat
- Ce doc reste **dérivé** du contrat racine — toute divergence est de la dette
- Si un endpoint mentionné ici diverge du `CONTRAT-HUB-API-REF.md`, c'est l'API-REF qui gagne
