# Ticket — Mise en conformité Prospection avec CONTRAT-HUB.md (v1.2)

> **Source de vérité** : `../CONTRAT-HUB.md` (racine `veridian-platform/`)
> **Matrice de conformité actuelle** : section §10 du contrat, snapshot 2026-05-19
> **Auteur** : Agent Prospection (session 2026-05-19)
> **Priorité** : P1 — bloque le pilotage cross-app du Hub sur Prospection
> **Estim. globale** : 3-4 jours dev focus, ~12 sous-tâches

---

## Pourquoi ce ticket

Le contrat Hub v1.2 (2026-05-18 soir) définit 8 endpoints obligatoires côté
chaque app downstream, plus webhooks app→Hub, plus tests d'intégration. **Prospection
n'a pour l'instant qu'un seul endpoint conforme à 50 % (provision avec HMAC custom)**
sur les 12 exigés.

Conséquence : le Hub ne peut pas piloter Prospection en update-plan, suspend/resume,
attach-owner, health check, soft-delete/restore. Le seul flow qui marche est :
- signup user Hub → POST provision Prospection → magic_link → user connecté.

Tout le reste (admin lifecycle panel, billing Stripe propagé, mode dégradé paywall
sur soft_delete) est cassé silencieusement.

---

## Matrice de l'écart (extraite §10 contrat)

### Endpoints downstream — 12 obligatoires

| # | Endpoint | État Prospection | Action |
|---|---|---|---|
| 1 | `POST /api/tenants/provision` | ⚠️ HMAC custom `email:ts` | Migrer vers HMAC standard `{ts}.{body}` |
| 2 | `POST /api/tenants/update-plan` | ❌ Manquant | À créer |
| 3 | `POST /api/tenants/attach-owner` | ❌ Manquant | À créer |
| 4 | `POST /api/tenants/suspend` | ❌ Manquant | À créer |
| 5 | `POST /api/tenants/resume` | ❌ Manquant | À créer |
| 6 | `GET /api/tenants/[id]/health` | ❌ Manquant | À créer |
| 7 | `POST /api/workspaces/generateMagicLink` | ⚠️ Custom `regenerate-login` côté Hub | À créer endpoint side-Prospection avec Bearer api_key |
| 8 | `POST /api/tenants/soft-delete` (v1.1) | ❌ Manquant | À créer |
| 9 | `POST /api/tenants/restore` (v1.1) | ❌ Manquant | À créer |
| 10 | `POST /api/tenants/purge` (v1.1) | ❌ Manquant | À créer |
| 11 | `GET /api/tenants/[id]/usage-summary` (v1.1) | ❌ Manquant | À créer |
| 12 | `POST tenant.touched` webhook (v1.1) | ❌ Manquant | App émet, pas reçoit |

### Plans supportés — Prospection actuelle vs cible

| Plan | État | Action |
|---|---|---|
| `freemium` | ✅ implémenté | OK |
| `pro` | ✅ implémenté | OK |
| `enterprise` | ✅ implémenté | OK |
| `starter` | ⚠️ Listé Hub, pas implémenté | À implémenter ou à retirer côté Hub |
| `lifetime_site_vitrine` | ❌ | À implémenter (plan offert obligatoire §3.3) |
| `lifetime_partner` | ❌ | À implémenter (plan offert obligatoire §3.3) |
| `internal` | ❌ | À implémenter (plan offert obligatoire §3.3) |

### Webhooks app → Hub — 5 obligatoires

Aucun n'est implémenté côté Prospection. Le Hub attend :
- `tenant.suspended` — quand un tenant est suspendu côté app (action user / quota)
- `tenant.resumed` — symétrique
- `tenant.deleted` — quand un tenant est supprimé côté app
- `tenant.owner_changed` — transfert d'ownership (roadmap v2)
- `tenant.quota_exceeded` — pour push notif user / alerting admin

### Sécurité / Auth

- ⚠️ HMAC format non-standard (`email:ts` au lieu de `{ts}.{body}`)
- ⚠️ Anti-replay timestamp 5min à vérifier (le contrat dit 5min, le code permet drift)
- ⚠️ Comparaison temps constant à vérifier (déjà `timingSafeEqual`, à confirmer test)
- ❌ Pas de pattern Bearer api_key tenant pour les calls user-to-app (le contrat
  §6.2 demande ce pattern pour `generateMagicLink` notamment)
- ❌ Pas de pattern Bearer Hub webhook token pour les webhooks app→Hub (§6.3)

### Tests d'intégration

- ⚠️ Scénario provision idempotent (Cas A/B/C §5.1) : non vérifié explicitement
- ❌ Scénario attach-owner
- ❌ Scénario suspend/resume cycle
- ❌ Scénario health avant/après attach
- ❌ Scénario soft-delete + paywall obfuscation
- ❌ Scénario touch → repousse purge_eligible
- ❌ Scénario purge avec garde-fous

### Observabilité

- ⚠️ Logs JSON structurés avec `tenant_id` : à vérifier (probablement pas
  systématique)
- ❌ Endpoint `/metrics` Prometheus (recommandé §13.2)
- ❌ Alertes Grafana minimales (§13.4)

### Idempotency-Key

- ❌ Aucun endpoint n'accepte le header `Idempotency-Key` (§5.11)
- ❌ Pas de stockage `veridian_idempotency_keys`
- ❌ Pas de cleanup cron expired

### Mode dégradé paywall obfusqué (v1.1)

| Item | État | Action |
|---|---|---|
| Liste `SENSITIVE_FIELDS` | ✅ existe en code | À documenter (`docs/sensitive-fields.md`) |
| Obfuscation côté serveur (33% + bullets) | ✅ implémenté | OK |
| 402 sur écritures | ⚠️ Partiel | À compléter |
| Composant `<Paywall>` modale | ✅ | OK |
| Composant `<BlurredText>` UI | ✅ | OK |
| Activation sur `soft_deleted` | ❌ (pas encore de soft_delete) | À brancher quand endpoint 8 livré |
| Activation sur `trial_expired` | ✅ | OK |

---

## Plan d'exécution proposé (3-4 jours)

### Phase 1 — Bloc auth standardisé (J1, 4h)

1. **Créer `src/lib/hub/hmac.ts`** : helpers `verifyHubHmac(timestamp, body, signature)` + `verifyTenantApiKey(apiKey, request)` (Bearer). Centralise toute la vérif et fournit `timingSafeEqual` partout.
2. **Migrer `POST /api/tenants/provision` vers HMAC standard** : signature = `HMAC_SHA256(secret, "${timestamp}.${bodyJson}")`. Garder la backward-compat 30 jours via flag env `ACCEPT_LEGACY_HMAC=1` (le Hub agent migrera de son côté pendant la fenêtre).
3. **Documenter dans `docs/hub-contract.md`** la convention HMAC + un curl de test reproductible.

**Vérif** : test integration `__tests__/api/tenants/provision.test.ts` étendu (cas legacy + nouveau, anti-replay, signature invalide), curl manuel sur staging vert.

### Phase 2 — Endpoints lifecycle de base (J1-J2, 8h)

4. **`POST /api/tenants/update-plan`** : §5.2 du contrat. Comportement `plan_source` critique : rejet 409 si Stripe veut downgrade un lifetime. Append dans table `veridian_plan_history` (migration Prisma à créer).
5. **`POST /api/tenants/attach-owner`** : §5.3. Idempotent additif, jamais d'écrasement.
6. **`POST /api/tenants/suspend` + `/api/tenants/resume`** : §5.4. Ajouter colonne `suspended_at` sur table `tenants` Prisma. Bloquer les écritures côté app si suspendu (middleware).
7. **`GET /api/tenants/[id]/health`** : §5.5. `magic_link_capable` = false si pas d'owner attaché OU api_key révoquée OU tenant soft-deleted.

**Vérif** : 4 nouveaux fichiers tests `__tests__/api/tenants/*.test.ts`, scénarios suspend → écriture bloquée → resume → écriture passe. Smoke Chrome staging post-deploy (cf [[project_chrome_mcp_login_pattern]]).

### Phase 3 — Magic link standardisé (J2, 3h)

8. **`POST /api/workspaces/generateMagicLink`** : §5.6. Auth Bearer api_key (pas HMAC). Garder le `regenerate-login` existant pour le Hub historique, mais marquer deprecated dans logs.

### Phase 4 — Plans offerts (J2, 2h)

9. **Ajouter plans `lifetime_site_vitrine`, `lifetime_partner`, `internal`** dans `src/lib/trial.ts` + `src/lib/queries/lead-quota.ts`. Tous les 3 = quota illimité, pas de trial_ends_at, pas de feature lockée. Cohérent §3.3 du contrat.

### Phase 5 — Webhooks app → Hub (J3, 6h)

10. **Créer `src/lib/hub/webhooks.ts`** : helper `emitHubWebhook(event, payload)` avec retry exponential 3 essais, Bearer Hub webhook token (`HUB_WEBHOOK_TOKEN` env), idempotency-key généré.
11. **Brancher les 5 webhooks** : `tenant.suspended` (depuis endpoint suspend), `tenant.resumed`, `tenant.deleted` (depuis cleanup), `tenant.quota_exceeded` (depuis `/api/leads/*` quand quota freemium dépassé). `tenant.owner_changed` = à câbler si transfert d'ownership implémenté un jour.

**Vérif** : test que chaque endpoint provoquant un état déclenche le webhook (mock fetch), retry sur 5xx, logs structurés.

### Phase 6 — Lifecycle v1.1 (soft-delete, restore, purge, usage-summary, touch) (J3-J4, 10h)

12. **Migration Prisma** : ajouter `deleted_at`, `purge_eligible_at`, `last_touched_at` sur table `tenants`. Backfill `last_touched_at = updated_at`.
13. **`POST /api/tenants/soft-delete`** : §5.8. Marque deleted_at + purge_eligible_at=NOW+90j. Active le mode paywall (déjà implémenté côté UI).
14. **`POST /api/tenants/restore`** : symétrique. Annule deleted_at, repousse purge_eligible_at.
15. **`POST /api/tenants/purge`** : DESTRUCTIF. Garde-fou : refuse si `purge_eligible_at > NOW()`. Cascade DELETE sur outreach, call_log, claude_activity, followups, lead_segments, appointments, etc. Retourner `rows_deleted` par table.
16. **`GET /api/tenants/[id]/usage-summary`** : retourne `data_volume_mb`, `last_user_activity_at`, `prospects_seen_count`, `outreach_sent_count`. Pour le Hub admin panel.
17. **Émission `tenant.touched`** : trigger sur toute activité user (visit prospect, send outreach, etc.). Throttle 1×/h pour pas spammer le Hub.

### Phase 7 — Tests d'intégration scénario complet (J4, 4h)

18. **`__tests__/integration/hub-contract.test.ts`** : scénario complet bout-en-bout contre Postgres test :
    - Provision tenant idempotent (Cas A/B/C)
    - Attach owner → vérif role
    - Health check → magic_link_capable=true
    - Generate magic link → 200 + URL
    - Update plan → vérif applied + history
    - Suspend → écriture bloquée → webhook `tenant.suspended` émis
    - Resume → écriture passe → webhook `tenant.resumed` émis
    - Soft-delete → paywall actif → webhook `tenant.deleted` émis
    - Touch → repousse purge_eligible_at
    - Restore → tenant repasse en suspended
    - Purge → cascade DELETE + retourne rows_deleted

**Vérif** : test bloquant en CI staging.

### Phase 8 — Observabilité + Idempotency-Key (optionnel, à décider avec Robert) (J4+, 4h)

19. **Logs JSON structurés** : middleware Next qui wrappe chaque request avec `{ tenant_id, request_id, path, status, latency_ms }`.
20. **Endpoint `/metrics` Prometheus** : avec lib `prom-client`. Métrique de base : `http_requests_total{route,status}`, `provisioning_total{result}`, `magic_link_emitted_total`.
21. **Idempotency-Key sur les 4 endpoints critiques** (provision, update-plan, soft-delete, purge) : table `veridian_idempotency_keys (key, response_body, expires_at)`, cleanup cron quotidien.

---

## Coordination avec l'agent Hub

L'agent Hub doit, en parallèle :

1. Migrer son client Prospection (`veridian-hub/lib/prospection/client.ts`) vers HMAC standard.
2. Ajouter Prospection dans la matrice `/api/admin/tenants/[id]/plan`.
3. Mettre à jour la matrice §10 du contrat à chaque endpoint livré.
4. Provisionner le secret `HUB_WEBHOOK_TOKEN` côté repo Prospection (GitHub Secrets) pour signer les webhooks reçus.

Robert route ce ticket vers l'agent Hub via un fichier `veridian-hub/todo/2026-05-19-prospection-conformity.md` symétrique.

---

## Risques / Tradeoffs

- **HMAC migration** : si la coupure n'est pas synchrone Hub/Prospection, les provisionings échouent. Mitigation : flag `ACCEPT_LEGACY_HMAC=1` pendant la fenêtre de transition (30 jours).
- **Endpoint `purge`** : action irréversible. Smoke Chrome obligatoire avant de l'autoriser depuis l'admin Hub. Garde-fou côté code + côté UI.
- **Webhooks app→Hub** : retry 3× peut perdre des événements si le Hub est down >5min. Pour suspend/deleted, c'est critique → faut un fallback (queue Redis ? ou simple log + reconciliation cron). Décision à prendre avec Robert.
- **`internal` plan** : il faut bien isoler ce plan pour éviter qu'un user freemium passe en internal par hack. Côté DB, contrainte CHECK `plan IN (...)` + côté API, seul le Hub HMAC peut le set (pas le user lui-même).

---

## Definition of Done

- ✅ 12 endpoints du §10.1 de la matrice à `✅`
- ✅ 5 webhooks du §10.3 à `✅`
- ✅ Tous les items §10.4 (auth) à `✅`
- ✅ Test integration scénario complet bloquant en CI
- ✅ Smoke Chrome staging + prod passé après chaque phase
- ✅ Section §10 du contrat mise à jour (Prospection passe de ⚠️/❌ à ✅ partout)
- ✅ Documentation `prospection/docs/hub-contract.md` à jour
- ✅ Migration `veridian-infra/todo/TODO-LIVE.md` retire le ticket "Prospection ⚠️"

---

## Réponse — (à compléter quand traité)
