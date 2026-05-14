# CI Prospection — Sprint Staging-First (état au 2026-05-14)

> Source de vérité du chantier CI/CD Prospection.
> Objectif : **CI verte obligatoire sur branche `staging` AVANT toute possibilité de merge vers `main`**.
> Aucun push direct sur `main` n'atteint la prod. Toute prod passe par PR `staging → main`.
>
> Standard de référence : [`veridian-platform/CI-ARCHITECTURE.md`](../../../../CI-ARCHITECTURE.md)
> Dev server staging doc : `dev-pub:~/traefik-staging/README.md`

---

## 🎯 État actuel (fin de session 2026-05-14)

### Endpoints vivants

| Env | URL | Statut |
|---|---|---|
| **PROD** | https://prospection.app.veridian.site | ✅ 200 (compose `prospection` nouveau pattern, container 9s post-redeploy) |
| **STAGING** | https://prospection.staging.veridian.site | ✅ 200 (workflow staging-deploy validé bout-en-bout) |

### Branches

- `main` HEAD = `81b2714` (Merge PR #1)
- `staging` HEAD = `9c09edf` (Husky NUCLEAR activé)

### 🔴 Husky NUCLEAR actif

Depuis commit `9c09edf` : **tout push refusé tant qu'une route API est dans `tests-pending.txt`**.
- **70 routes API en pending** actuellement → tous les push échouent
- Override technique disponible : `PENDING_OVERRIDE=1 git push ...` (réservé hotfix critique, à justifier en PR)
- Pour débloquer : écrire les 70 tests `__tests__/api/<path>.test.ts` + retirer les lignes correspondantes de `tests-pending.txt`

---

## ✅ Done en session

### Brique 1 — Test mapping + pre-push hook (commit `0d5a797` main)
- `husky@^9.1.7` devDep + script `prepare`
- `.husky/pre-push` branché via `core.hookspath=.husky/_`
- `scripts/ci/check-test-mapping.sh` — règle 1-pour-1 mapping canonique (routes/components/hooks/lib) + fallback `test-coverage-map.yaml` + comptage exports/HTTP verbs strict
- `tests-pending.txt` baseline 199 fichiers
- `test-coverage-map.yaml` initialisé

### Brique 1bis — Husky strict pending (commit `ec715f6`)
Si tu modifies un fichier listé dans `tests-pending.txt` sans modifier son test → push refusé.

### Brique 1ter — Husky NUCLEAR (commit `9c09edf`)
Tout push refusé tant qu'une `src/app/api/**/route.ts` est dans `tests-pending.txt`. Override `PENDING_OVERRIDE=1`.

### Workflow staging-first (commits `38279ad..ec715f6` mergés via PR #1)
**Validé bout-en-bout** — run 25851652520 vert.

- **Compose pattern by-design** :
  - `infra/docker-compose.base.yml` (config commune : image, env, healthcheck, port)
  - `infra/docker-compose.prod.yml` (override Traefik `dokploy-network`)
  - `infra/docker-compose.staging.yml` (override Traefik `staging-edge`)
  - `infra/docker-compose.yml` (auto-généré via `scripts/ci/render-compose.sh prod` pour Dokploy)
- **`.github/workflows/prospection-deploy-staging.yml`** (on:push staging) — 5 jobs validés :
  1. Quality gate : lint + typecheck + unit + audit + test-mapping
  2. Build : buildx + cache GHA + push GHCR `staging-<sha7>` + `staging-latest`
  3. Deploy : SSH dev-pub → `docker compose pull && up -d`
  4. Smoke : `/api/health` + `/api/auth/providers` + `/login`
  5. Cleanup : prune containers/images filter `com.veridian.env=staging`
- **`.github/workflows/prospection-staging-teardown.yml`** (on:delete branch staging) — auto teardown
- **Infra staging** :
  - `~/traefik-staging/` (Robert avait setup) + network `staging-edge` partagé
  - `~/postgres-staging/` créé : Postgres 15-alpine dans staging-edge, DB `prospection` clonée depuis prod (996k entreprises, 19 users, 11 tenants, 13 workspaces)
  - Secrets `STAGING_DATABASE_URL` + `STAGING_AUTH_SECRET` provisionnés

### Workflow prod étendu (`prospection-ci.yml`, mergé via PR #1)
- Job `quality` avec test-mapping en début (avant tsc/eslint/vitest)
- `docker/setup-buildx-action@v3` + cache GHA → builds successifs ~30s
- Output `sha7` aligné sur staging
- Job `smoke-prod` post-webhook Dokploy : `/api/health` (6×15s) + `/api/auth/providers` + `/login`

### GitOps prod (modèle Prospection appliqué)
- Compose `prospection-prod` migré du legacy raw → sourceType=git
- Healthcheck `127.0.0.1`, pas de `container_name`, `pull_policy: always`
- Webhook GitHub → Dokploy avec `content_type=json` (corrigé en session, cf `memory/project_github_webhook_content_type.md`)
- Auto-deploy validé : push main → webhook → Dokploy `compose pull && up -d` → smoke prod 200

### Audit fin état PROD (`PROD-AUDIT.md`)
Snapshot 2026-05-14 11:01 : tous endpoints OK, containers healthy, certs valides, ressources OK, anomalies non bloquantes listées.

### Branch protection script (`scripts/ci/setup-branch-protection.sh`)
Prêt à exécuter, **non lancé** (cf P0 ci-dessous).

### Secrets repo déjà provisionnés
- `DEPLOY_SSH_KEY`, `CR_PAT`, `DOKPLOY_API_KEY`
- `STAGING_DATABASE_URL`, `STAGING_AUTH_SECRET`, `STAGING_TENANT_API_SECRET`, `STAGING_SUPABASE_*`, `STAGING_ROBERT_PASSWORD`
- `PROD_SUPABASE_*`, `PROD_TENANT_API_SECRET`

---

## 🔴 P0 — Bloquant pour reprise

### #1 — Écrire les 70 tests routes API
Sans ça, **plus aucun push staging ne passe** (NUCLEAR refuse).

- Liste des 70 routes : `grep -E '^src/app/api/.*/route\.ts$' tests-pending.txt`
- Pour chacune : créer `__tests__/api/<path>.test.ts` (au moins 1 `describe()` par HTTP verb + 1 `test()` par export public)
- Retirer la ligne correspondante de `tests-pending.txt`
- Estimation : 70 tests × 5-10 min = 6h-12h, **parallélisable** entre agents

**Convention** : tests integration Vitest contre Postgres testcontainers (cf jobs `integration` du workflow main pour pattern). MSW si appel à un autre service interne (Hub, Notifuse).

### #2 — Activer branch protection main (bloqué par #1)
Script prêt : `bash scripts/ci/setup-branch-protection.sh`
- Required checks : Quality gate, CVE audit, build, integration, Trivy CRITICAL+HIGH
- `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false`

**À activer SEULEMENT après #1** — sinon main verrouillé pour de vrai (les checks required ne passeront plus tant que NUCLEAR bloque). Vérifier d'abord qu'un run main vert post-fix existe pour que GitHub accepte de référencer les status checks.

---

## 🟡 P1 — Suite (non-bloquant)

### Renforcer Husky / CI
- [ ] **Cron hebdo** `wc -l tests-pending.txt` → issue GitHub auto avec progression (cible 0)
- [ ] **Coverage map non-canonique** : déclarer les `lib/*.ts` couverts par tests d'intégration (`test-coverage-map.yaml`)
- [ ] **MSW** pour tests component DOM (cf CI-ARCHITECTURE.md §2 : interdit `vi.mock('fetch'|'axios'|'@/lib/api/*')`)
- [ ] **Lint rule custom** eslint-plugin-no-fetch-mock

### Migrations Prisma — Expand & Contract (CI-ARCHITECTURE.md §4)
- [ ] `scripts/ci/check-migration-safety.sh` bloque `DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... SET NOT NULL`, `RENAME COLUMN`, `RENAME TABLE`, `CREATE INDEX` sans `CONCURRENTLY`, `ALTER COLUMN ... TYPE`
- [ ] Exception via `prisma/migrations/contract/` + commit message `[contract-phase]` + fichier `VEX-MIGRATION.md`
- [ ] Job CI `test-backward-compat` : pull image `previous` (N-1) + apply migration N + smoke contre DB schéma N

### Trivy 9 capacités complètes (CI-ARCHITECTURE.md §5)
- [ ] FS scan tous scanners (`--scanners vuln,secret,misconfig,license`) avec SARIF → GitHub Security tab
- [ ] EOL distro check (`--exit-on-eol 1`)
- [ ] SBOM CycloneDX uploadé en artifact
- [ ] `.trivyignore.yaml` VEX justification par CVE
- [ ] Cron hebdo `trivy image` sur containers prod

### Anti-flakiness E2E Playwright
- [ ] `playwright.config.ts` : `retries: process.env.CI ? 2 : 0`
- [ ] Reporter `json` activé → artifact `playwright-results.json`
- [ ] Workflow scheduled hebdo `playwright-flaky-detector.yml` : flake rate > 5% sur 7j → PR auto `test.fixme()` + issue GitHub
- [ ] Aucun E2E ne déclenche rollback prod avant 3 échecs consécutifs

### Cleanup GHCR
- [ ] Retention policy : purger tags `staging-<sha>` > 30j (garder 10 derniers)
- [ ] Idem `<sha>` prod si on accumule

### Render-compose check sémantique
Bug actuel : `docker compose config` produit des YAML différents selon version CLI (map vs liste pour `environment`). Check textuel désactivé.
- [ ] Réimplémenter avec yq + parsing normalisé pour check sync `base + prod` vs `infra/docker-compose.yml`

---

## 🟢 Done bonus
- [x] Mémoire `feedback_no_permission_asking.md` — règle "exécuter jusqu'au bout, jamais demander permission"
- [x] Mémoire `feedback_husky_strict_pending.md` — Husky strict tests-pending.txt
- [x] Mémoire `project_github_webhook_content_type.md` — bug `content_type=json` pas `application/json`
- [x] Mémoire `project_staging_dev_server.md` — Traefik staging-edge + postgres-staging + clone recipe
- [x] TODO-LIVE.md veridian-infra : P0 GitOps RÉSOLU
- [x] `todo/apps/prospection/PROD-AUDIT.md` — snapshot état prod 2026-05-14

---

## 🚫 Hors scope (autres apps, autres agents)
Standard CI Veridian s'applique aux 6 apps mais ce fichier ne concerne que **Prospection**. Pour les autres :
- `veridian-hub/todo/apps/hub/CI.md`
- `veridian-analytics/todo/apps/analytics/CI.md`
- `veridian-cms/todo/apps/cms/CI.md`
- `notifuse-veridian/TODO.md` (section CI)

**Notifuse CI bloqué** : commit local prêt mais rebase conflit + 119 violations test-mapping. À traiter en session dédiée notifuse.

---

## Glossaire des décisions techniques prises

| Décision | Choix | Pourquoi |
|---|---|---|
| Workflow staging | Branche `staging` permanente + PR vers main | Trace claire GitFlow, simple solo |
| Env staging | Dev server `37.187.199.185` séparé de prod | Isolation totale, prod intouchable |
| Reverse proxy dev | Traefik standalone + network `staging-edge` | Pattern label-driven natif (Dokploy retiré du dev 2026-05-14) |
| Orchestration dev | Docker compose vanilla via SSH GitHub Actions | Pas de Dokploy agent, GitHub Actions pilote direct |
| Compose pattern | base.yml + prod.yml + staging.yml (DRY) | Source unique vs duplication ; consolidé auto-généré pour Dokploy |
| DB staging | Clone pg_dump depuis prod | Données réelles 996k entreprises, isolation totale prod |
| Auto-nettoyage | Per-deploy + on-delete-branch | Pollution courante + fin de feature |
| Husky strictness | NUCLEAR (0 dette routes API tolérée) | Décision Robert 2026-05-14 fin de session |
| Branch protection main | enforce_admins=true (after #1) | Robert solo ne peut pas bypass son garde-fou |

---

## Risques & Tradeoffs actifs

- **NUCLEAR mode bloque tout push** tant que 70 tests pas écrits. Override `PENDING_OVERRIDE=1` mais coûteux à utiliser (visible en PR description, suspect en review).
- **Dev server unique** : si dev down, plus de staging → blocage merges prod. Mitigation : compose simple, redéployable ailleurs.
- **GHCR storage cost** : tags `staging-<sha>` peuvent exploser sans retention policy. P1 #cleanup-ghcr.
- **Webhook content_type** : récurrent sur tous les repos GitHub→Dokploy. Si tu crées un nouveau webhook, vérifie `content_type=json`, pas `application/json` (cf `memory/project_github_webhook_content_type.md`).
- **Renaming service prospection-prod → prospection** : fait dans cette session, container recréé. Pour les autres apps qui migreront, prévoir micro-coupure ~30s à chaque renommage.
