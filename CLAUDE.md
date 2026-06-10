# Prospection — Dashboard B2B SaaS

> ## 🔴 Règle d'or Veridian — zéro contournement (gravée Robert 2026-06-10)
> **Interdit absolu** : cron bricolé, SQLite/store parallèle, job maison pour
> ÉVITER l'API ou la DB réelle de l'app. On travaille AVEC le vrai système :
> coder propre → tester staging → fixer la logique → MAJ DB staging si besoin
> → test lourd → push prod. Un blocage (accès, credential) se débloque via le
> lead, il ne se contourne pas. Détail : CLAUDE.md racine veridian-platform.


> Voir le CLAUDE.md racine (`../CLAUDE.md`) pour la vision globale.

## Promotion prod = §20 CI-ARCHITECTURE (graduée par risque)

**Depuis 2026-05-20**, Prospection suit le modèle §20 de
`veridian-hub/docs/CI-ARCHITECTURE.md` : promotion graduée par risque.
L'agent **arbitre lui-même** le tier des commits non-promus et **exécute
la promo autonome** sauf tier 💀 CRITIQUE.

### 4 tiers — comportement agent

| Tier | Exemples | Action agent |
|---|---|---|
| 🟢 BAS | doc, todo, test seul | Auto-promote CI via marker `[risk:low]` |
| 🟡 MOYEN | route non-auth, UI dashboard | CI vert + reco écrite → promote autonome |
| 🔴 HAUT | auth, migration DB, lib partagée, compose prod | E2E headfull staging 100% + reco + monitoring 10min + auto-rollback → **promote autonome** |
| 💀 CRITIQUE | DROP COLUMN, rotation secret, refonte session | **Demande go/stop explicite à Robert** |

### Protocole tier 🔴 HAUT (le plus fréquent pour Prospection)

1. Push staging → CI staging vert
2. `bash scripts/e2e/staging-full.sh` → 100% des journeys verts (sinon HOLD)
3. Reco écrite dans le chat (audit, pas demande)
4. `git checkout main && git pull --ff-only && git merge --ff-only origin/staging && git push origin main`
5. Watch CI prod jusqu'à vert
6. **Vérif SHA container actif** (`docker inspect`) — si stale > 5min après push, `compose.deploy` API Dokploy forcé (le webhook foire silencieusement, cf [[project_prospection_dokploy_webhook_fail]])
7. **Si migration Prisma** : appliquer manuellement (cf [[project_prisma_migrate_pattern]]) — la CI prod ne le fait pas
8. **Re-run E2E headfull contre PROD** (`STAGING_URL=https://prospection.app.veridian.site bash scripts/e2e/staging-full.sh`) — un test vert sur staging ne garantit pas la prod
9. Monitoring 10 min via `bash /tmp/monitor_prod_postdeploy.sh` (auto-rollback si 3 fails consécutifs)

### Veto Robert (mots-clés)

| Mot-clé | Effet |
|---|---|
| `stop` / `attends` | Annule la promo en cours ou bloque la prochaine |
| `rollback` | `git revert` + push main + monitoring jusqu'à recovery |
| `freeze` | Gèle tous les push staging→main jusqu'à `unfreeze` |
| `unfreeze` | Reprend le flow normal |

### Historique

- **2026-05-19** : règle "humain only" posée après 2 auto-promotions silencieuses (incident Dokploy webhook foiré). Règle utile mais trop restrictive.
- **2026-05-20** : §20 publié dans CI-ARCHITECTURE.md, remplace la règle "humain only". Validé par première promo `ffe7947 → 4732603` (tier 🔴, 12 commits, 3 migrations, auth refactor) — exécutée autonome, aucun veto, monitoring 10/10.

### Pièges à connaître (avant chaque promo)

- ⚠️ CI prod **ne fait PAS** `prisma migrate deploy` — appliquer manuellement
- ⚠️ Webhook GitHub→Dokploy peut foirer en silence — vérifier le SHA actif post-deploy
- ⚠️ E2E headfull staging ≠ E2E headfull prod — toujours re-runner contre prod après promo

---

## Ce que c'est

Dashboard de prospection commerciale B2B. 996K entreprises francaises
avec scoring technique, donnees INPI, pipeline commercial, system multi-tenant.

## Stack

- Next.js 15 (App Router) + npm
- Prisma + PostgreSQL (multi-tenant, tenant_id sur toutes les tables)
- Supabase Auth (JWT, middleware verification)
- Playwright (e2e tests)

## Structure

```
prospection/
├── src/
│   ├── app/            # Pages + API routes
│   │   ├── api/        # 20+ routes (prospects, pipeline, admin, stats, export)
│   │   ├── (auth)/     # Login page
│   │   └── (dashboard)/ # Prospects, pipeline, historique, settings, admin
│   ├── components/     # React components (dashboard, layout, ui)
│   ├── lib/
│   │   ├── queries/    # DB queries (Prisma)
│   │   ├── supabase/   # Auth, tenant resolution, user context
│   │   └── trial.ts    # Trial/freemium logic (HACKE: return false)
│   └── hooks/          # Custom React hooks
├── e2e/
│   ├── core/           # 6 specs INTOUCHABLES (bloquent le deploy)
│   ├── extended/       # 23 specs (non-bloquants, 3 browsers paralleles)
│   ├── _deprecated/    # Anti-patterns archives
│   └── helpers/auth.ts # Canonical user pattern (modele a suivre)
├── prisma/schema.prisma
├── Dockerfile
└── playwright.config.ts
```

## Commandes

```bash
cd prospection
npm ci
npm run build         # Build prod
npm test              # Vitest unit tests
npx playwright test e2e/core/ --project=chromium   # Core e2e
npx playwright test e2e/extended/ --project=chromium  # Extended e2e
```

## Tests

- **Core** (`e2e/core/`) : 6 specs, 33 tests, ~56s. BLOQUANTS. Voir `.claude/rules/core-tests.md`.
- **Extended** (`e2e/extended/`) : 23 specs, 83+ tests. NON-BLOQUANTS.
- **Unit** (`src/__tests__/`) : 57 tests Vitest.
- **Integration** (`e2e/integration/`) : tenant isolation tests (Prisma + Postgres).

## Multi-tenant

- `tenant_id` sur toutes les tables operationnelles
- Resolution : JWT → user_id → workspace_members → tenant_id (cache 60s)
- Admin : voit tout. Member : voit son workspace.

## API routes critiques

- `/api/health` — public, health check
- `/api/status` — public, status detaille + DB + counts
- `/api/prospects` — protegepar auth, filtres, pagination, quota freemium
- `/api/pipeline` — pipeline commercial
- `/api/admin/*` — CRUD membres, KPI, invitations

## Regles

- JAMAIS d'appel Supabase admin API dans un hot path (cache obligatoire)
- JAMAIS de signup en e2e (login comptes existants uniquement)
- `checkTrialExpired` = return false (hack temporaire, a recabler)
# retrigger


