# Tests E2E — veridian-prospection

> Convention de placement et helpers canoniques. Formalisée 2026-05-24
> (cf `todo/done/2026-05-23-e2e-convention-extended-vs-racine.md`).

## Convention de placement

| Dossier | Rôle | Statut deploy | Volume |
|---|---|---|---|
| `core/` | Squelette absolu (health, login, prospects list, auth gate) | **Bloquant** deploy prod | ≤ 6 specs, ≤ 60s total |
| `extended/` | Tests fonctionnels (1 feature = 1 spec) | Non-bloquant, 3 browsers parallèle | ~23 specs |
| `staging-full/` | Journeys lourds headfull (UI polish, screenshots) | Pilotés par skill `ui-polish-team` | Variable |
| `integration/` | Tests Prisma directs (tenant isolation, multi-row) — pas de browser | Non-bloquant | Quelques fichiers |
| `migrations/` | Tests versionnés (état d'une migration DB) | Bloquant migration | 1 par migration touchée |
| `_deprecated/` | Archive — ne plus modifier, ne plus exécuter | Ignoré | À supprimer (sprint dette) |

### Racine `e2e/`

**Pas de nouvelle spec en racine.** Toute nouvelle spec va dans `extended/`
(ou `core/` si critique). Les rares specs racine conservées ont une
raison documentée :

| Spec racine | Raison de la conserver |
|---|---|
| `dashboard-crawler.spec.ts` | Smoke crawler dédié, référencé explicitement par `.github/workflows/prospection-deploy-staging.yml` pour le check rapide post-deploy. Ne pas déplacer sans MAJ workflow. |

Pour tout autre cas, `git mv e2e/X.spec.ts e2e/extended/X.spec.ts` et
adapter les imports relatifs (`./helpers/...` → `../helpers/...`).

## Helpers canoniques

| Helper | Usage |
|---|---|
| `helpers/auth.ts` — `loginAsE2EUser(page, request)` | Login Auth.js v5 + seed idempotent du compte canonique (`E2E_USER_EMAIL`). Ne JAMAIS ré-implémenter de login Supabase/Auth.js inline (cf incident `done/2026-05-22-e2e-helper-auth-supabase-mort.md`). |
| `helpers/auth.ts` — `E2E_INVITED_EMAIL/PASSWORD` | Compte invité canonique (member, scope `own`) pour tests permission. |
| `helpers/console.ts` — `captureConsoleErrorsAfterLogin(page, [ignorePatterns])` | Attache `page.on("console")` APRÈS le login. Ne JAMAIS faire `page.on("console", …)` inline avant login : capture les 3 × 401 légitimes du root layout (cf `done/2026-05-23-e2e-console-listener-pattern-helper.md`). |
| `helpers/cross-app-login.ts` | Login cross-app Hub → Prospection (magic link). |
| `helpers/hub-hmac.ts` | Signature HMAC pour appels Hub côté tests. |

## Lancer les tests

```bash
# Tous les browsers extended (rapide, non-bloquant en local)
npx playwright test e2e/extended/ --project=chromium

# Tests core bloquants (à passer avant promotion)
npx playwright test e2e/core/ --project=chromium

# Journey lourd staging-full (mega battery — pré-requis promo prod)
HEADED=0 STAGING_URL=https://prospection.staging.veridian.site \
  bash scripts/e2e/staging-full.sh

# Intégration tenant isolation (Prisma direct, pas de browser)
npx playwright test e2e/integration/ --project=chromium
```

## Règles

1. **Auth** : si la spec a besoin d'auth, importe `loginAsE2EUser` depuis
   `helpers/auth.ts`. Pas de login inline (compte hardcodé, Supabase
   GoTrue, fetch CSRF manuel) — la dette `2026-05-22-e2e-specs-auth-supabase-inline.md`
   a déjà éliminé 10 doublons sur ce pattern.
2. **Listener console** : `captureConsoleErrorsAfterLogin()` après
   login. Pas de `page.on("console", …)` en `beforeEach` global avant
   login.
3. **Workers** : si une spec écrit en DB côté tenant canonique partagé,
   sérialise avec `test.describe.configure({ mode: "serial" })` pour
   éviter les flaky workers=4 (cf `done/2026-05-23-flaky-e2e-workers4-canonical-account.md`).
4. **Pas de doublon racine ↔ extended** : si tu touches une spec
   `extended/X.spec.ts`, vérifie qu'il n'existe pas de `e2e/X.spec.ts`
   obsolète qui dériverait silencieusement.
