# CI Prospection — Sprint Staging-First Pixel-Parfait

> Source de vérité du chantier CI/CD Prospection.
> Objectif : **CI verte obligatoire sur branche `staging` AVANT toute possibilité de merge vers `main`**.
> Aucun push direct sur `main` n'atteint la prod. Toute prod passe par PR `staging → main` avec CI verte + smoke staging via Chrome MCP vu OK par Robert.
>
> Standard de référence : [`veridian-platform/CI-ARCHITECTURE.md`](../../../../CI-ARCHITECTURE.md)
> Dernière maj : 2026-05-14

---

## ✅ Déjà fait (session 2026-05-13/14)

### Brique 1 — Test mapping local + pre-push hook
Commit `0d5a797` sur `main`.

- [x] `husky@^9.1.7` installé en devDep + script `prepare`
- [x] `.husky/pre-push` branché via `core.hookspath=.husky/_`
- [x] `scripts/ci/check-test-mapping.sh` — moteur règle 1-pour-1 :
  - mapping canonique par chemin (routes API, components, hooks, lib)
  - fallback `test-coverage-map.yaml` pour couvertures non-canoniques
  - comptage strict : nouveaux exports → nouveaux `test()`, nouveaux HTTP verbs → nouveaux `describe()`
  - détection migrations Prisma sans tests integration
- [x] `tests-pending.txt` — baseline 199 fichiers existants en dette (cible 0 sous 90 j)
- [x] `test-coverage-map.yaml` — vide, prêt à recevoir des entrées
- [x] Validé bout-en-bout :
  - fichier critique neuf sans test → exit 1, push refusé
  - fichier dans pending → warning + exit 0
  - working tree propre → exit 0
- [x] `npm audit fix` — 12 CVE high patchées (commit `99dbc93`)

### GitOps prod (modèle Prospection appliqué + dupliqué)
- [x] Compose `infra/docker-compose.yml` en sourceType=git, healthcheck `127.0.0.1`, pas de `container_name`, `pull_policy: always`
- [x] Webhook GitHub → Dokploy avec `content_type=json` (cf [`memory/project_github_webhook_content_type.md`](#))
- [x] Auto-deploy validé : push main → webhook → Dokploy `compose pull && up -d`

### Workflows GitHub Actions existants (déjà en place)
Sur la branche `main` actuellement :
- `prospection-ci.yml` — lint + typecheck + unit + integration
- `prospection-security-cve.yml` — npm audit + Trivy
- `prospection-e2e-cleanup.yml` — cleanup post-E2E
- `_audit-cve.yml` + `_trivy-image.yml` — workflows réutilisables

### Secrets repo déjà provisionnés (visibles via `gh secret list`)
- `DEPLOY_SSH_KEY` — SSH key pour déployer sur dev-pub / prod-pub
- `CR_PAT` — GitHub PAT pour push GHCR
- `DOKPLOY_API_KEY` — pilotage Dokploy
- `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_TENANT_API_SECRET`, `STAGING_ROBERT_PASSWORD`
- `PROD_SUPABASE_ANON_KEY`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `PROD_TENANT_API_SECRET`

---

## 🔴 À faire — Sprint staging-first (en cours)

### Étape 1 — Setup réseau dev server
**Pourquoi** : le dev server (`37.187.199.185` / `dev-pub`) n'a aucun reverse proxy. Le tunnel Cloudflare `85317eae-1877-4b09-a9d8-2c0b0a3003b1` existe mais flappe ("control stream encountered a failure") et ne route que `ssh.veridian.site`. Port 443 fermé en direct.

- [ ] **Décision** : réparer tunnel existant + ajouter ingress staging vs nouveau tunnel propre vs port forwarding direct (firewall OVH + Caddy)
- [ ] Tunnel Cloudflare config ingress : `prospection.staging.veridian.site → http://localhost:3000`
- [ ] DNS Cloudflare : `prospection.staging.veridian.site` CNAME → `<tunnel-id>.cfargotunnel.com` (déjà en A 37.187.199.185 actuellement, à migrer en CNAME tunnel)
- [ ] Smoke test : `curl https://prospection.staging.veridian.site/api/health` → 200 (sans container = doit retourner 502/503 propre)

### Étape 2 — Branche staging + compose dédié
- [ ] Créer branche `staging` depuis `main` actuel
- [ ] Créer `infra/docker-compose.staging.yml` :
  - image `ghcr.io/christ-roy/veridian-prospection:staging-${SHA}` (tag mouvant)
  - port `3000:3000` bind `127.0.0.1` (tunnel local-only)
  - ENV staging (DATABASE_URL staging, AUTH_SECRET staging, NEXTAUTH_URL=https://prospection.staging.veridian.site, etc.)
  - healthcheck IPv4
  - `pull_policy: always`
  - labels Docker pour identification (`com.veridian.env=staging`, `com.veridian.app=prospection`)
- [ ] Créer un `.env.staging.template` documentant toutes les ENV requises (sans valeurs)

### Étape 3 — Workflow deploy-staging
- [ ] `.github/workflows/prospection-deploy-staging.yml` :
  - **Trigger** : push sur `staging`
  - **Job 1 — gate qualité** (doit passer AVANT build, sinon stop) :
    - lint `next lint --quiet`
    - typecheck `tsc --noEmit`
    - unit `vitest run src/`
    - test-mapping `BASE_REF=origin/main scripts/ci/check-test-mapping.sh`
    - `npm audit --audit-level=high` bloquant
    - Trivy fs scan (vuln + secret + misconfig) bloquant CRITICAL+HIGH
  - **Job 2 — build image** : Docker buildx push GHCR avec tag `staging-${SHA::8}` + `staging-latest`
  - **Job 3 — deploy dev** : SSH dev-pub, `docker compose -f infra/docker-compose.staging.yml pull && up -d --remove-orphans`
  - **Job 4 — smoke staging** : `curl https://prospection.staging.veridian.site/api/health` → 200 ; `/api/auth/providers` → 200 ; `/login` → 200
  - **Job 5 — E2E core sur staging** : `npx playwright test e2e/core/ --project=chromium` contre `BASE_URL=https://prospection.staging.veridian.site`
  - Si l'un des jobs échoue : annotation GitHub + Telegram alert

### Étape 4 — Branch protection main
- [ ] `gh api -X PUT repos/Christ-Roy/veridian-prospection/branches/main/protection` :
  - `required_status_checks` : workflow `prospection-deploy-staging.yml` doit être vert
  - `required_pull_request_reviews` : 0 approvers (solo) mais review obligatoire de soi-même via auto-merge
  - `enforce_admins: true` (Robert ne peut pas bypass)
  - `allow_force_pushes: false`
  - `allow_deletions: false`
  - `restrictions: null` (pas de restriction d'auteur)
- [ ] Documenter dans `docs/DEPLOY.md` : "main est verrouillée, tout passe par staging"

### Étape 5 — Auto-nettoyage staging
**Pourquoi** : éviter que les vieilles images / containers / volumes pollue le dev server (39 GB déjà utilisés / 72 GB).

- [ ] **Auto-cleanup à chaque deploy staging** (dans `prospection-deploy-staging.yml` job 3) :
  - `docker image prune -af --filter "label=com.veridian.env=staging" --filter "until=168h"` (garde 7 jours)
  - `docker container prune -f --filter "label=com.veridian.env=staging" --filter "until=24h"` (garde 24h)
  - `docker volume prune -f --filter "label=com.veridian.env=staging"`
- [ ] **Auto-teardown sur delete branche staging** : workflow `prospection-staging-teardown.yml` trigger `on: delete` ref_type=branch :
  - SSH dev-pub : `docker compose -f infra/docker-compose.staging.yml down -v --rmi local`
  - Suppression DNS Cloudflare staging (optionnel, à confirmer)
  - Notification Telegram "Staging Prospection détruit"
- [ ] **Cron hebdo cleanup global dev** : `.github/workflows/_dev-cleanup.yml` `schedule: cron 0 3 * * 0` (dimanche 3h) :
  - `docker system prune -af --filter "until=336h"` (>14 jours)
  - `docker volume prune -f` (volumes orphelins)
  - Notification du gain en GB
- [ ] **GHCR retention** : config Renovate ou action `actions/delete-package-versions` pour purger les tags `staging-<sha>` plus vieux que 30 jours (gardant les 10 derniers)

### Étape 6 — Merge staging → main = deploy prod
- [ ] Workflow `prospection-deploy-prod.yml` :
  - **Trigger** : push sur `main` (uniquement merge depuis staging valide ce trigger grâce à la branch protection)
  - **Job 1 — re-run gate complet** (même qualité que staging — défense en profondeur)
  - **Job 2 — re-tag image** : `docker pull ghcr.io/.../prospection:staging-${SHA} && tag :latest && push`
  - **Job 3 — pas de deploy direct** : Dokploy webhook s'en charge (déjà branché). Workflow attend juste la propagation et fait le smoke prod.
  - **Job 4 — smoke prod** : `https://prospection.app.veridian.site/api/health` → 200
  - **Rollback auto** : si smoke échoue, re-tag `staging-previous-sha → latest` et re-trigger Dokploy
- [ ] Documenter dans `docs/DEPLOY.md` la procédure manuelle de rollback prod

### Étape 7 — Standardisation E2E flaky-detection
**Pour Robert** : "rien en prod sans qu'une sonde l'ait vue d'abord" mais avec auto-rollback, un E2E flaky = rollback nucléaire pour rien.

- [ ] `playwright.config.ts` : `retries: process.env.CI ? 2 : 0` (3 essais max)
- [ ] Reporter `json` activé → upload artifact `playwright-results.json`
- [ ] Workflow scheduled hebdo `playwright-flaky-detector.yml` :
  - lit 100 derniers runs
  - `flake_rate = passed_after_retry / total_runs`
  - `> 5% sur 7j` → PR auto qui ajoute `test.fixme()` + issue GitHub `flaky-test: <name>`
- [ ] Test E2E ne déclenche aucun rollback prod avant **3 échecs consécutifs**

---

## 🟡 P1 — Suite (non-bloquant pour staging-first)

### Migrations Prisma — Expand & Contract
Référence : `CI-ARCHITECTURE.md §4`. Critique pour auto-rollback sans casse DB.

- [ ] `scripts/ci/check-migration-safety.sh` :
  - bloque `DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... SET NOT NULL`, `RENAME COLUMN`, `RENAME TABLE`, `CREATE INDEX` sans `CONCURRENTLY`, `ALTER COLUMN ... TYPE`
  - exception via `prisma/migrations/contract/` + commit message `[contract-phase]` + fichier `VEX-MIGRATION.md`
- [ ] Job CI étage 2 `test-backward-compat` :
  - pull image `previous` (tag N-1)
  - apply migration de la PR
  - run container `previous` contre la DB en schéma N
  - smoke fonctionnel → migration safe

### Trivy 9 capacités complètes
Référence : `CI-ARCHITECTURE.md §5`. Déjà partiellement appliqué (vuln + image scan).

- [ ] FS scan tous scanners (`--scanners vuln,secret,misconfig,license`) avec SARIF → GitHub Security tab
- [ ] EOL distro check (`--exit-on-eol 1`) en étage 2
- [ ] SBOM CycloneDX uploadé en artifact
- [ ] `.trivyignore.yaml` versionné avec VEX justification par CVE (pas `.trivyignore` aveugle)
- [ ] Cron hebdo `trivy image` sur containers `docker ps` prod + notif Telegram + annotation Grafana

### Coverage map non-canonique
- [ ] Identifier les fichiers critiques **légitimement** couverts ailleurs (ex : `lib/billing.ts` couvert par `__tests__/api/payment.test.ts`) et les déclarer dans `test-coverage-map.yaml`

### Résorber `tests-pending.txt`
- [ ] Cron hebdo `wc -l tests-pending.txt` → issue GitHub auto avec progression
- [ ] Objectif : 0 sous 90 jours (cible 2026-08-11)

### MSW pour tests component DOM
Référence : `CI-ARCHITECTURE.md §2`. Interdit `vi.mock('fetch')`, `vi.mock('@/lib/api/*')`.

- [ ] Installer `msw@^2` en devDep
- [ ] `__tests__/mocks/handlers.ts` + `__tests__/mocks/server.ts`
- [ ] Migrer les tests component existants qui mockent fetch vers MSW
- [ ] Lint rule custom (eslint-plugin-no-fetch-mock) qui interdit `vi.mock('fetch'|'axios'|'@/lib/api/*')`

---

## 🟢 Done bonus (hors scope initial mais utile)

- [x] Mémoire `feedback_no_permission_asking.md` — règle "exécuter jusqu'au bout, jamais demander permission"
- [x] Mémoire `project_github_webhook_content_type.md` — bug `content_type=json` pas `application/json`
- [x] TODO-LIVE.md veridian-infra : P0 GitOps archivé en RÉSOLU

---

## 🚫 Hors scope (autres apps, autres agents)

Le standard CI Veridian s'applique aux 6 apps mais ce fichier ne concerne que **Prospection**. Les chantiers parallèles sur les autres apps sont tracés dans :
- `veridian-hub/todo/apps/hub/CI.md` (à créer si pas déjà existant)
- `veridian-analytics/todo/apps/analytics/CI.md` (idem)
- `veridian-cms/todo/apps/cms/CI.md` (idem)
- `notifuse-veridian/TODO.md` section CI

Agents parallèles : ne pas modifier ce fichier sans coordination.

---

## Glossaire des décisions techniques prises

| Décision | Choix | Pourquoi |
|---|---|---|
| Workflow staging | Branche `staging` permanente + PR vers main | Trace claire, GitFlow classique, simple pour solo |
| Env Dokploy | Dev server `37.187.199.185` séparé de prod | Isolation totale, prod intouchable pendant tests |
| Orchestration dev | Docker compose vanilla via SSH (pas Dokploy agent) | Moins lourd, GitHub Actions pilote directement |
| Auto-nettoyage | Per-deploy + on-delete-branch + cron hebdo | Trois niveaux : pollution courante, fin de feature, ménage général |
| Branche protection main | enforce_admins=true | Robert solo ne peut pas bypass son propre garde-fou |

---

## Risques & Tradeoffs

- **Tunnel Cloudflare dev** : si le tunnel reste cassé, tout le staging-first tombe. **Mitigation** : monitorer cloudflared via systemd + alerte Telegram.
- **Dev server unique** : si dev down, plus de staging → blocage merges prod. **Mitigation** : Docker compose simple à redéployer ailleurs si besoin.
- **GHCR storage cost** : tags `staging-<sha>` peuvent exploser. **Mitigation** : retention policy 30j max 10 versions.
- **Risque flakiness E2E** : sans retries + flaky detector, un test foireux bloque tous les merges. **Mitigation** : étape 7 obligatoire dans le sprint.
