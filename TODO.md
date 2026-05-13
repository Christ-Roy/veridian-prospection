# TODO — Veridian Prospection

> Repo extrait du monorepo le 2026-05-13. État de la session :
> [Mémoire](`~/.claude/projects/-home-brunon5-Bureau-veridian-platform/memory/session_2026-05-13_prospection_extract.md`)
> Détail legacy : [`docs/legacy-monorepo-todo/TODO.md`](./docs/legacy-monorepo-todo/TODO.md)

## État actuel

- **Auth** : ✅ Auth.js v5 + Prisma + veridian-core-db (fin Supabase 2026-05-08, deploy prod 2026-05-13 14:06)
- **Image prod** : `ghcr.io/christ-roy/prospection:latest` (commit `4108a2a` = HEAD)
- **Stack Dokploy** : `0mJI-sSt6jcOMr_2QJ1iI` (mode Raw, pas encore Git)
- **DB Prod** : container Postgres séparé `code-prospection-saas-db-1` (postgres:15-alpine)
- **CI** : verte (unit + audit + build + integration + docker push GHCR)
- **Container prod** : Up, /api/health 200, 997400 leads

## 🔥 Priorités prochaine session

### 1. Transférer le package GHCR vers ce repo

Aujourd'hui `ghcr.io/christ-roy/prospection` est lié à l'ancien repo legacy
`Christ-Roy/prospection`. On contourne avec un secret `CR_PAT`. À nettoyer :

1. GitHub Settings → Packages → choisir `prospection`
2. Manage Actions Access → Add repository → `Christ-Roy/veridian-prospection`
3. Workflow `prospection-ci.yml` ligne `password: ${{ secrets.CR_PAT }}` → revenir à `${{ secrets.GITHUB_TOKEN }}`
4. Supprimer le secret `CR_PAT` du repo

### 2. Bascule Dokploy Raw → Git propre

Cf [`docs/runbooks/dokploy-gitops-pattern.md`](./docs/runbooks/dokploy-gitops-pattern.md).

**LEÇON CRITIQUE de la tentative ratée du 2026-05-13** : les ENV inline du
compose Raw **ne sont PAS auto-héritées** quand on bascule en `sourceType=git`.
Dokploy passe au container uniquement les ENV setées dans Stack > Environment.

**Avant** de basculer :

1. Récupérer toutes les ENV inline du compose Raw actuel :
   ```bash
   ssh prod-pub 'sudo cat /etc/dokploy/compose/compose-connect-redundant-firewall-l5fmki/code/docker-compose.yml' \
     | grep -E '^\s+[A-Z_]+:' | head -20
   ```
2. Pour chacune (DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, TENANT_API_SECRET, APP_URL, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_HUB_URL...) : ajouter dans Dokploy Stack > Environment via API
3. **Ajouter aussi** `DEPLOY_ENV=prod` + `TRAEFIK_HOST=prospection.app.veridian.site`
4. **Tester sur la stack staging d'abord** (`j4wqH-42gbeZini9_Ls2k`)
5. Puis bascule prod via API atomique :
   ```bash
   curl -X POST .../compose.update -d '{"json":{
     "composeId":"0mJI-sSt6jcOMr_2QJ1iI",
     "sourceType":"git",
     "customGitUrl":"https://github.com/Christ-Roy/veridian-prospection.git",
     "customGitBranch":"main",
     "composePath":"infra/docker-compose.yml",
     "autoDeploy":true,
     "triggerType":"push",
     "watchPaths":["infra/**"]
   }}'
   ```
6. Test deploy + rollback prêt : `compose.update sourceType=raw` revert immédiat

### 3. Cleanup code mort Supabase

Le runtime ne tape plus Supabase (Auth.js a remplacé partout) mais le code source contient encore :

- [ ] Supprimer `src/lib/supabase/{middleware,server,user-context,api-auth,tenant}.ts` (5 fichiers)
- [ ] Retirer les ~17 imports `@supabase/*` dans `src/app/api/**`, `src/app/login`, `src/app/invite`
- [ ] Vérifier `/api/auth/token` route — utilise probablement encore Supabase pour valider le `tenant.prospectionLoginToken` (à refactor en Prisma local)
- [ ] `npm uninstall @supabase/ssr @supabase/supabase-js`
- [ ] Retirer ENV `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANON_KEY`, `SERVICE_ROLE_KEY` du compose Dokploy + du workflow CI build-args

### 4. Self-hosted runner (optionnel, optimisation)

Si on veut récupérer les builds rapides 25s sur dev server :

1. SSH dev-pub
2. `sudo /home/ubuntu/actions-runner/config.sh --url https://github.com/Christ-Roy/veridian-prospection --token <token>`
3. Le runner accepte les jobs `runs-on: [self-hosted, veridian]`
4. Adapter le job `docker` du workflow pour utiliser le runner self-hosted

Sinon ubuntu-latest fait le job (90s vs 25s, pas critique).

## Backlog hérité du monorepo (priorité moyenne)

Voir [`docs/legacy-monorepo-todo/TODO.md`](./docs/legacy-monorepo-todo/TODO.md) section "Sprint en cours" :

- **P0.6** Finir pricing : payant geo 20€, payant full 50€, achat par lot, UI onboarding
- **P1.1** Audit cross-SaaS standards (soft delete + audit log + health check)
- **P1.6** Nettoyage workspaces + isolation membres + rôles owner/admin/member/viewer
- **P1.7** Prisma Migrate + API sync data (main agent only, NE PAS déléguer)
- Setup dev rapide (DB prod sur Tailscale, replication logique, `make dev-env`)
- Regroupement multi-SIRET par dirigeant
- Tests e2e manquants : pipeline-kanban, phone-call-flow (Telnyx SIP), stripe-paywall, claude-ai-flow, global-full-flow

## Backlog pipeline data (open-data)

Voir [`docs/legacy-monorepo-todo/open-data/TODO.md`](./docs/legacy-monorepo-todo/open-data/TODO.md) :
- Acquisition INPI, enrichissement API gouv, backups

## Dépendances inter-apps

- **Hub → Prospection** : provisioning (`POST /api/tenants/provision` HMAC), magic-link (`POST /api/tenants/magic-link` HMAC). Secret `TENANT_API_SECRET` partagé.
- **Prospection → Hub** : aucune (lecture seule sur `tenants` Prisma core-db, pas d'appel HTTP outbound vers Hub).
- **Stripe** : webhook `/api/webhooks/stripe` reçoit updates plan/trial, update `Tenant` Prisma directement.

## Standards CI verts à maintenir

- `npm audit --omit=dev --audit-level=high` = 0 (verrou bloquant)
- Trivy image scan (CRITICAL+HIGH, ignore-unfixed) = 0 (verrou bloquant)
- `tsc --noEmit` clean
- `eslint src/ --quiet` clean
- Vitest unit + integration verts
