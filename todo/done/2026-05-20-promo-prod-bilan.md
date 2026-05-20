# 2026-05-20 — Bilan promotion prod Prospection (tier 🔴 HAUT §20.6)

> **Session** : agent Prospection, journée 2026-05-19/20
> **Promotion** : `ffe7947` → `4732603` (12 commits cumulés)
> **Tier de risque** : 🔴 HAUT (3 migrations Prisma + auth refactor + provision modifié + middleware visibility)
> **Résultat** : ✅ Promo réussie, monitoring 10/10 OK, fix CHATEX en live

## Ce qui a été livré en prod

### 1. Visibility cross-membre (#2026-05-19-audit-bugs-prospect-status-cross-membre)

- Helper canonique `src/lib/queries/visibility.ts` (4 modes : discovery/mine/team/admin)
- `/prospects` mode `discovery` forcé : commercial ne voit plus les leads ouverts par les collègues (anti-double-appel)
- `/historique` filtre `o.user_id = moi` par défaut
- `/pipeline` filtre `o.user_id = moi`, `visibility_scope='all'` bascule en team-view
- Migration 0006 : 189 outreach legacy orphans backfillés sur owner tenant
- Tests : 16 unit visibility + tests refactor routes API

### 2. Sync status ↔ pipeline_stage atomique

- Helper canonique `src/lib/outreach/status.ts` (24 valeurs status → 11 stages canon)
- `applyStatusTransition()` avec anti-régression (un appel sur lead en `acompte` n'écrase pas)
- Refactor 5 writers (`patchOutreach`, `updateOutreach`, phone webhooks, mail send)
- Migration 0007 : 223 lignes canonicalisées (0 valeurs non-canoniques après)
- `lib/types.ts` : STATUS_OPTIONS étendu à 28 valeurs + fallback safe (plus de "A contacter" trompeur)
- SW v2 : cache busting automatique (les commerciaux n'ont pas besoin de hard-refresh)
- `/api/history` no-store : pas de cache HTTP heuristique sur les statuts

### 3. Autologin Hub→Prospection (#2026-05-20-auth-token-hmac-fix-and-supabase-cleanup Phase 1)

- `/api/auth/token` réécrit zéro Supabase (validation Prisma + Auth.js JWT)
- Migration 0008 : 3 colonnes `prospectionLoginToken*` sur Tenant + index partiel
- `/api/tenants/provision` persiste le token sur Tenant local
- One-shot atomique : `updateMany WHERE usedAt:null` (anti race condition multi-tab)
- Session Auth.js JWT via `next-auth/jwt encode()` (cookie `__Secure-authjs.session-token`, 90j)
- Test live cross-app via Chrome MCP : signup Hub → click "Open Prospection" → autologin OK

### 4. Infra

- Fusible mem_limit 6600m / cpus 3.6 sur container prosp (60% VM)

### 5. Tests anti-régression durables

- **`e2e/staging-full/critical-journeys.spec.ts`** (8 tests, Playwright headfull) :
  1. Login credentials Robert → dashboard
  2. /historique → **CHATEX badge "Site demo"** (anti-régression bug originel)
  3. /pipeline render colonnes
  4. /prospects API → status canoniques uniquement
  5. SW v2 actif
  6. /api/health 200
  7. Pas d'erreur uncaught console
  8. SSO Hub→Prosp HMAC + session + replay token_used
- **`scripts/e2e/staging-full.sh`** : runner avec `xvfb-run` fallback
- **`playwright.staging-full.config.ts`** : config dédiée

## Pièges rencontrés pendant la promo (capturés en memory)

1. **CI prod ne fait PAS `prisma migrate deploy`** → migrations 0006/0007/0008 manuellement appliquées via container `node:22-alpine` éphémère sur `dokploy-network`.
2. **Webhook GitHub→Dokploy foiré silencieux** → smoke CI prod renvoyait 200 sur ancien container (18h), `compose.deploy` API forcé pour pull le nouveau.
3. **E2E headfull staging ≠ E2E headfull prod** → un test vert sur staging ne garantit pas la prod (cache bundle JS, image stale, etc.). Toujours re-run le E2E avec `STAGING_URL=https://prospection.app.veridian.site` après promo tier 🔴+.

→ `memory/project_promo_prod_pieges_2026_05_20.md` créé pour les sessions futures.

## Tickets fermés

- ✅ `2026-05-19-audit-bugs-prospect-status-cross-membre.md` (P1/P2/P3/P4/P5 livrés ; P6 segments + P8 admin UI restent à faire en passe 2)
- ✅ `2026-05-20-auth-token-hmac-fix-and-supabase-cleanup.md` Phase 1 (P3 Phase 2 cleanup Supabase global reste, déjà dans dette-technique)

## Tickets actifs restants

- `2026-05-19-ci-architecture-sections-18-19.md` (doc/process)
- `2026-05-19-dette-technique-audit.md` (P1-P8, ~3-4j)
- `2026-05-19-hub-contract-conformity.md` (P1, 12 endpoints obligatoires)
- `2026-05-19-hub-contract-phase1-suite.md` (P3 boucle validation Hub)
- `2026-05-19-v13-multi-membre-cross-app.md` (P2 sync-member)

## Métriques §20.11

- **Tier prod** : 🔴 HAUT
- **Délai push staging → promo main** : ~24h (multiples cycles fix, push, test)
- **Délai promo main → prod stable confirmée** : ~30 min (CI 10 min + migration manuelle 5 min + Dokploy redeploy 2 min + E2E PROD 1 min + monitoring 10 min)
- **Veto Robert** : 0 (cible §20.11 < 1/mois)
- **Rollback déclenché** : 0
- **Cible KPI tier 🔴** : < 1h push→prod-stable. **Atteint** ✓
