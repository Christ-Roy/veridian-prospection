# 🚀 GIGA-SPRINT v1.5 — Cross-app invitation flow Prospection

> **Type** : Sprint d'orchestration multi-tickets
> **Sévérité** : 🔴 P1 — débloque P1 invitation Hub côté Prospection
> **Owner** : agent Prospection (cette nouvelle session)
> **Créé** : 2026-05-21 (fin de session de spécification contrat v1.5)
> **Réfère** :
>   - `veridian-hub/docs/CONTRAT-HUB.md` v1.5 (vision + invariants)
>   - `veridian-hub/docs/CONTRAT-HUB-API-REF.md` v1.1 (référence technique)
>   - `docs/hub-contract.md` (implémentation locale Prospection)

## TL;DR

Une nouvelle session démarre. Le contrat v1.5 est gravé, les angles morts
couverts, les permissions §11bis tranchées. **Le sprint qui suit livre 4
tickets dans cet ordre précis** avec dépendances câblées.

**Estim total** : ~3 jours dev focus (24h) + ~1 jour tests + smoke prod.

## Ordre d'exécution (dépendances dures)

```
1. Migration users.hub_user_id (§3.7)
   └─ pré-requis de 2, 3, 4

2. Endpoint POST /api/veridian/workspaces/[id]/attach-member (§5.22)
   ├─ pré-requis : 1
   └─ DÉBLOQUE le P1 Hub (lib/invitations/accept.ts:112 TODO)

3. Endpoints multi-membre tenant-level (§5.18.3, §5.19, §5.20, §5.21)
   ├─ pré-requis : 1
   ├─ peut tourner en parallèle de 2 (mais on enchaîne plus simple)
   └─ inclut webhook tenant.member_role_changed app→Hub (§5.18.4)

4. Smoke prod cross-app + coupure legacy 30j (§6.5)
   ├─ pré-requis : 2 + 3 livrés en prod
   └─ valide bout-en-bout puis poser ACCEPT_LEGACY_HMAC=0
```

## Tickets actifs et dépendances

| Ordre | Ticket | Tier §20 | Estim | Bloque |
|---|---|---|---|---|
| 1 | `2026-05-21-add-hub-user-id-column.md` | 🟡 MOYEN | 1j | 2, 3 |
| 2 | `2026-05-21-hub-attach-member-endpoint.md` | 🔴 HAUT | 1j | P1 Hub |
| 3 | `2026-05-19-v13-multi-membre-cross-app.md` | 🔴 HAUT | 2j | seat pricing |
| 4 | `2026-05-19-hub-contract-phase1-suite.md` | 🟡 MOYEN | 30min | finalisation |

**Hors sprint cross-app** (mais dans le backlog) :

| Ticket | Tier | Notes |
|---|---|---|
| `2026-05-20-dette-tech-db-destructive-sprints.md` | 💀 CRITIQUE | DROP TABLE — go explicite Robert obligatoire |
| `2026-05-21-business-plan-pricing-features.md` | doc business | Itératif, pas dev |
| `SECURITY-CVE.md` | 🟡 MEDIUM | postcss 8.4.31 → 8.5.10 (5min, à faire en passant) |

## Détail ticket 1 — Migration users.hub_user_id

**Lieu** : `2026-05-21-add-hub-user-id-column.md`

**Spec récap** :
- Migration Prisma additive : `ALTER TABLE users ADD COLUMN hub_user_id UUID NULL`
  + index UNIQUE partiel (WHERE hub_user_id IS NOT NULL)
- Helper `src/lib/hub/identity.ts:resolveOrCreateUserFromHub()`
- Câblage dans `provision`, `attach-owner`, futurs `attach-member`, `sync-member`
- Tests `src/lib/hub/identity.test.ts` (5 tests min)

**Application prod** : migration manuelle conteneur `node:22-alpine` éphémère
sur réseau Docker DB ([[project_prisma_migrate_pattern]]). Baseline P3005
si nécessaire.

**Critère succès** : helper testé en CI, migration appliquée prod sans
downtime, premier endpoint qui backfille en succès lors d'un appel HMAC réel.

## Détail ticket 2 — Endpoint attach-member workspace-level

**Lieu** : `2026-05-21-hub-attach-member-endpoint.md`

**Spec récap** (du contrat §5.22.2 + API-REF section ATTACH) :
- Route : `POST /api/veridian/workspaces/[workspaceId]/attach-member`
- Auth : HMAC standard `verifyHubHmac`
- Body : `{ hub_user_id, hub_user_email, role, invitation_id }`
- Response 201/200 avec `member_id`, `role`, `login_url`
- **Idempotent**, **JAMAIS écraser un rôle local** (cf §5.22.4)
- Audit log obligatoire `workspace.member.attached_via_hub`

**Tests** :
- HMAC valide → 201 + row + audit
- HMAC invalide → 401
- Replay → 200 `already_member=true`
- Replay role différent → 200, role LOCAL préservé, log info
- Workspace inconnu après HMAC OK → 404
- Workspace soft_deleted → 410
- Tenant suspended → 423

**Critère succès** : déploiement staging vert, smoke HMAC réussi côté Hub
(P1 `lib/invitations/accept.ts:112` câble le call, bascule 202 → 200).

## Détail ticket 3 — Endpoints multi-membre tenant-level

**Lieu** : `2026-05-19-v13-multi-membre-cross-app.md` (mis à jour v1.5)

**Spec récap** (API-REF sections SYNC, RM, RESTM, FREEZE, UNFREEZE) :

| Endpoint | Spec API-REF | Comportement |
|---|---|---|
| `POST /api/tenants/[id]/sync-member` | §SYNC | Ajoute au workspace par défaut (premier créé) |
| `POST /api/tenants/[id]/remove-member` | §RM | Soft delete sur TOUS les workspace_members du user pour ce tenant |
| `POST /api/tenants/[id]/restore-member` | §RESTM | Annule soft delete |
| `POST /api/tenants/[id]/freeze-members` | §FREEZE | Active paywall obfusqué sur les users listés |
| `POST /api/tenants/[id]/unfreeze-members` | §UNFREEZE | Désactive le freeze |
| Webhook `tenant.member_role_changed` | §5.18.4 | App → Hub quand admin app change le rôle local |

**Particularité Prospection** :
- N workspaces par tenant : `sync-member` ajoute au premier workspace
  `ORDER BY created_at ASC LIMIT 1`. Si aucun, crée `default`.
- `remove-member` : soft delete sur TOUS les workspaces du tenant
- Garde-fou owner → 409 `cannot_remove_owner` (cf §11bis.2.1)

**Tests** : couvrir les 11 scénarios listés dans le ticket source.

## Détail ticket 4 — Smoke prod + coupure legacy

**Lieu** : `2026-05-19-hub-contract-phase1-suite.md`

Action 30min après que 2 et 3 sont en prod :
1. Smoke staging cross-app : flow complet invitation → accept → attach → login
2. Si vert : smoke prod identique
3. Si vert : poser `ACCEPT_LEGACY_HMAC=0` et `ACCEPT_LEGACY_BEARER=0`
   dans Dokploy ENV Prospection prod
4. Surveiller 10min via monitoring §20
5. Si problème : rollback les flags à `1` immédiatement

## Critères de fin de sprint

- [ ] Ticket 1 livré : colonne `users.hub_user_id` en prod, helper testé,
      premier backfill observable dans audit_log.
- [ ] Ticket 2 livré : route `attach-member` testée HMAC + idempotente,
      Hub `accept.ts:112` câblé en prod, bascule 202 → 200 observée.
- [ ] Ticket 3 livré : 5 endpoints + 1 webhook, 11 tests pass.
- [ ] Ticket 4 livré : smoke prod OK, flags legacy à 0.
- [ ] **Test bout-en-bout réel** : Robert depuis Hub UI `/dashboard/team`
      invite un autre email → invité reçoit mail → click → accept → arrive
      sur prospection.app.veridian.site loggé sur le bon workspace.

## Pièges à éviter (mémoires actives)

- [[project_prisma_migrate_pattern]] : CI prod n'applique pas
  `prisma migrate deploy`. Application manuelle conteneur éphémère.
- [[project_prospection_dokploy_webhook_fail]] : smoke CI ment. Vérifier
  image SHA manuellement post-deploy, force `compose.deploy` API Dokploy
  si bascule pas faite.
- [[project_promo_prod_pieges_2026_05_20]] : E2E PROD obligatoire
  post-promo tier 🔴+. Toujours re-runner E2E contre prod.
- [[project_route_safe_parse_pattern]] : `.catch(() => ({}))` Veridian
  classique pour request.json() — Husky pre-push blocking.

## Coordination cross-agent

**Agent Hub** : suit `veridian-hub/todo/2026-05-21-contrat-hub-v15-sync.md`
en parallèle. Une fois ticket 2 livré côté Prospection, Hub câble
`lib/invitations/accept.ts:112`. Pas d'attente bloquante — chacun ship dans
son repo, on synchronise sur les smokes croisés.

**Agent Notifuse** : suit `notifuse-veridian/todo/2026-05-21-contrat-hub-v15-sync.md`
en parallèle. Notifuse a aussi son endpoint `attach-member` à livrer (en Go).
Indépendant de Prospection.

## Ce ticket reste ouvert tant que

…tous les sous-tickets ne sont pas archivés dans `done/` ET que le
test bout-en-bout est passé en prod.

Une fois validé, archiver dans `done/` avec un bilan final court.

---

## État — 2026-05-22 (session giga-sprint)

**Sprint v1.5 livré sur STAGING, PAS encore en prod.** Bundle de 27 commits
staging non promus (`origin/main..origin/staging`).

- ✅ T1 hub_user_id + helper — **EN PROD** (promu tôt)
- ✅ T2 attach-member — **EN PROD** (promu tôt)
- ✅ T6 webhook ENV — **EN PROD**
- 🟡 T3 multi-membre (5 endpoints + webhook) — staging vert, smoke 11/11
- 🟡 T7 tenant email-or-UUID — staging vert (cf ticket dédié)
- 🟡 T13 patch routes tenants/[id]/* — staging vert
- ⏳ T4 smoke prod + coupure legacy — bloqué tant que T3/T7/T13 pas en prod

**Bombes prod détectées par audit T17** (toutes corrigées par le bundle staging,
attendent la promo) :
1. `/health` avec email → 500 (fix = T7)
2. 0/21 users ont hub_user_id (backfill cron à faire post-promo)
3. `frozen_at` absent DB prod (fix = migration 0011 à apply)
4. `push_subscriptions`/`audit_log` tables absentes prod (`/api/push/subscribe` crashe P2021)

**Reste à faire** : promo prod du bundle (go Robert requis pour les tier 💀
DROP COLUMN) + réconciliation `_prisma_migrations` prod (désynchronisé à 0010).

## ✅ Archivé 2026-05-22 — livré et vérifié en prod
