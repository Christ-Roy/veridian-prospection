# Prospection — TODO detaille

> Source de verite strategique : [`../../TODO-LIVE.md`](../../TODO-LIVE.md)
> UI polish solo : [`UI-REVIEW.md`](./UI-REVIEW.md)
> **Pipeline data** : [`open-data/TODO.md`](./open-data/TODO.md) — acquisition, enrichissement, backups
>
> App principale : dashboard B2B de prospection. 996K entreprises, leads, outreach, pipeline.
> Next.js 15, Prisma, Postgres dediee, Playwright e2e, Stripe paywall.

## Etat actuel

- **Version** : voir `prospection/package.json`
- **Dernier deploy prod** : voir `gh run list -w prospection-ci.yml`
- **URL prod** : https://prospection.app.veridian.site
- **URL staging** : https://saas-prospection.staging.veridian.site
- **Sante** : 🟢 (stable, e2e verts)
- **Freemium actuel** : 300 leads distribues selon `score_dept` (lead-quota.ts)
- **Stack auth** : ✅ **Auth.js v5 + Prisma + veridian-core-db** (fin Supabase 2026-05-08 PR #4, deploy prod 2026-05-13 14:06)
- **Image prod** : `ghcr.io/christ-roy/prospection:latest` (commit `4686e0a` = main HEAD)
- **Stack Dokploy** : `compose-connect-redundant-firewall-l5fmki` (composeId `0mJI-sSt6jcOMr_2QJ1iI`, mode Raw)
- **DB Prod** : container Postgres séparé `code-prospection-saas-db-1` (postgres:15-alpine)

## 🟢 Fin Supabase finalisée (2026-05-13)

> Session 2026-05-13 : audit révèle que la prod tournait encore sur image
> `:staging` du 2026-05-06 (commit pré-PR #4). Le code "fin Supabase" était
> mergé sur main depuis le 2026-05-08 mais jamais déployé. Compose Dokploy
> édité le 2026-05-11 17:56 avait forcé `:staging` au lieu de `:latest`.

**Action menée** :
- Canary test `:latest` sur dokploy-network → Next.js Ready 180ms, `/api/health` 200 + db ok + 997400 leads
- Snapshot compose pré-bascule + container inspect (`/tmp/prospection-prebascule-20260513-1405/`)
- Push compose `image: :latest` via Dokploy API `compose.update` (atomique)
- Redeploy via `compose.redeploy` → 18/18 healthchecks OK pendant 90s, zero downtime
- Container actuel : `prospection-prod-1` sur `:latest` (SHA `8d62477e` = commit `4686e0a`)
- Connexions sortantes : 1 vers Postgres prospection (`10.0.1.81:5432`), **AUCUNE vers Supabase Kong** ✅

**Cleanup session** :
- ✅ `stash@{2}` (saas-flow polish 2026-05-10) sauvé → PR #92 (`test/prospection-saasflow-polish`)
- ✅ 11 branches locales supprimées (9 `chore/ci-prospection-*-no-timeout` PRs #19-#24 mergées + `chore/prospection-cve-gate` 65f98d5 sur main + `feat/prospection-authjs-migration` obsolète PR #4 refait)
- ✅ 6 branches remote supprimées (mêmes `chore/ci-prospection-*-no-timeout` + `feat/prospection-authjs-migration` + `feat/prospection-gitops-migration` PR #58 mergée)
- ✅ `stash@{0}` (lockfile parasite) droppé
- 📁 Archive doc TODO ex-branche authjs : `/tmp/prospection-archive/TODO-from-authjs-branch-2026-05-10.md` (à supprimer si plus utile)

**Reste à faire pour vraiment couper Supabase de partout** :
- [ ] **Cleanup code mort** : `prospection/src/lib/supabase/{middleware,server,user-context,api-auth,tenant}.ts` → 5 fichiers dead-code (le SDK ne tape Supabase qu'avec cookie `sb-*` qui n'existe plus avec Auth.js). À supprimer + retirer imports dans les 17 fichiers consumers.
- [ ] **Retirer SDK npm** : `npm uninstall @supabase/ssr @supabase/supabase-js` dans `prospection/`
- [ ] **Compose Dokploy ENV cleanup** : retirer `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `ANON_KEY`, `SERVICE_ROLE_KEY` du compose
- [ ] **Route `/api/auth/token`** : utilisée par magic-link Hub→Prospection. Vérifier qu'elle utilise Prisma local (table `tenants` core-db), pas Supabase
- [ ] **Audit hub** : si hub appelle encore prospection via Supabase service-role, casser cette dépendance (hors scope prospection)
- [ ] **Stack Supabase elle-même** : ne peut être coupée qu'après cleanup hub + audit cms + audit autres apps (hors scope prospection)

## 🚀 Sprint GitOps Veridian — prospection (pilot 2026-05-13)

> Sprint global : `~/Bureau/SPRINT-GITOPS-VERIDIAN.md`. Prospection sert de pilot
> de fait (Notifuse devait piloter mais n'a pas démarré). Runbook pattern écrit
> au passage : `runbooks/dokploy-gitops-pattern.md`.

### Phase A — Migration GitOps (Raw → Git provider)

- [x] Snapshot forensique compose live + container inspect (image SHA, env, labels)
- [x] Récupérer SHA digest registry images (prospection + postgres)
- [x] Branche `feat/prospection-gitops-migration` depuis `origin/main`
- [x] Créer `infra/services/prospection/docker-compose.yml` (SHA-pinné, DEPLOY_ENV-aware, healthcheck `/api/health`)
- [x] `.env.example` + `README.md` dans `infra/services/prospection/`
- [x] Runbook GitOps `runbooks/dokploy-gitops-pattern.md` (pilot)
- [ ] PR `feat/prospection-gitops-migration` → main mergée (CI verte)
- [ ] **Bascule Dokploy UI** Raw → Git (manuel — Robert ou validation conjointe) :
  - Stack `compose-connect-redundant-firewall-l5fmki` → Settings → Provider Git
  - Repo veridian-platform, branch `main`, path `infra/services/prospection/docker-compose.yml`
  - Activer Auto Deploy + coller webhook dans GitHub repo Settings → Webhooks
  - **Avant la bascule** : vérifier que les ENV (AUTH_SECRET, ANON_KEY, SERVICE_ROLE_KEY, TENANT_API_SECRET, DATABASE_URL) sont bien dans Dokploy stack Environment — ajouter aussi `DEPLOY_ENV=prod` et `TRAEFIK_HOST=prospection.app.veridian.site`
- [ ] Premier deploy manuel via Dokploy UI → smoke 10x `/api/health`
- [ ] Test idempotence : commit no-op (commentaire README) → push main → webhook redeploy zero-downtime
- [ ] Test rollback : `git revert` du commit no-op → push main → webhook redeploy état précédent

### Phase B — CI security

- [x] `.github/workflows/prospection-security-cve.yml` (Trivy CRIT+HIGH bloquant, ignore-unfixed, SARIF Security tab, cron quotidien 3h UTC)
- [x] `.github/dependabot.yml` (npm prospection/ groupé par famille, docker `infra/services/prospection/`, github-actions)
- [x] `.github/renovate.json` (auto-merge patches Trivy-clean, Next/React/Auth.js manuels)
- [x] Job `audit` npm déjà branché dans `prospection-ci.yml` (commit 65f98d5, branche `chore/prospection-cve-gate`)

### Phase C — Loop validation 7 jours (à démarrer après bascule Dokploy)

- [ ] J+1 : vérifier webhook GitHub déclenche bien Dokploy redeploy (test no-op)
- [ ] J+1 : `obs check security` → 0 CRIT/HIGH sur image deployed
- [ ] J+2 : vérifier que Dependabot a ouvert ses premières PRs (lundi 8h)
- [ ] J+3 : vérifier que Trivy CI **bloque** une PR si CVE introduite (sabotage temporaire)
- [ ] J+7 : 0 CRIT/HIGH, 0 incident, mission marquée `[done]`

### Follow-ups identifiés pendant le sprint

- [ ] **Cross-app inter-comm violation** (cf `~/Bureau/cc-saas/prompts/applicatif/07-inter-app-communication.md`) :
  `SUPABASE_URL: http://compose-parse-digital-alarm-974mhw-kong-1:8000` dans le compose live
  utilise un nom de container interne (au lieu de `https://api.app.veridian.site`).
  Le compose Git garde la valeur via `${SUPABASE_URL}` (pas de regression), mais c'est
  fragile. À fix dans une PR dédiée hors sprint GitOps.
- [ ] **Composes legacy à nettoyer** : `infra/docker-compose.*.yml` (17 fichiers) divergent
  tous de la prod. Cleanup à planifier — pas dans ce sprint pour éviter le bruit.
- [ ] **DB Postgres pas en GitOps** : `code-prospection-saas-db-1` est dans un compose
  Dokploy séparé non identifié. À migrer en GitOps séparément (avec backup + tests
  restauration) une fois la prospection-prod stable en Git.

## 🔗 Hub side TODO — câbler le bouton "Open Prospection" sur magic-link à la demande (2026-05-08)

> Endpoint Prospection livré : `POST /api/tenants/magic-link` (HMAC, idempotent,
> rotation pure du `prospection_login_token`). Branche `feat/tenants-magic-link`.
> Le bouton actuel du Hub fonctionne pour les nouveaux signups (24h fenêtre) tant
> que ce qui suit n'est pas câblé — donc pas urgent, mais 24+ tenants existants
> sont actuellement cassés au-delà de 24h.

**Côté Hub** (`hub/`) :

- [ ] Créer `hub/app/api/admin/prospection/magic-link/route.ts` — pattern miroir
  de `hub/app/api/admin/notifuse/magic-link/route.ts`. Auth `auth()` + check
  ownership ou `isPlatformAdmin`. Body `{ tenantId }` (= email owner Prospection).
  Appelle `POST ${PROSPECTION_API_URL}/api/tenants/magic-link` avec :
  - `tenant_id`: email du tenant
  - `timestamp`: `Date.now()`
  - `signature`: `createHmac("sha256", PROSPECTION_TENANT_API_SECRET).update("${email}:${ts}").digest("hex")`
  Renvoie `{ login_url, expires_at }` au client.
  ⚠️ Le secret `PROSPECTION_TENANT_API_SECRET` côté Hub = `TENANT_API_SECRET` côté
  Prospection (même string déjà déployée en Dokploy) — pas de nouveau secret à
  provisionner.
- [ ] Modifier `hub/app/dashboard/components/ProspectionCard.tsx:34-66` :
  remplacer la logique `tokenValid && loginUrl ? open(loginUrl) : POST regenerate-login`
  par un appel systématique `POST /api/admin/prospection/magic-link` au clic, puis
  `window.open(data.login_url)`. Supprimer la prop `loginUrl`/`tokenValid`.
- [ ] Mettre à jour `hub/app/dashboard/page.tsx:73-87` : retirer la lecture
  `prospectionLoginToken*` (devient inutile), garder uniquement `prospectionProvisionedAt`
  pour afficher le badge "Active".
- [ ] Tests Vitest sur la nouvelle route Hub (auth, ownership, success, propagation
  des erreurs Prospection).
- [ ] Smoke test prod : ouvrir un tenant > 24h après signup, cliquer "Open
  Prospection" → doit logger sans `?error=`.

**Cleanup différé (chantier séparé, pas urgent)** :

- [ ] Supprimer côté Hub les colonnes `prospectionLoginToken`,
  `prospectionLoginTokenCreatedAt`, `prospectionLoginTokenUsed` du schéma Prisma
  (devenues mortes une fois le bouton recâblé). Migration `Existing tenants:`
  nécessaire.
- [ ] Supprimer la route `hub/app/api/prospection/regenerate-login/route.ts`
  (remplacée par `magic-link`). Vérifier zéro appelant restant avant.
- [ ] Côté Prospection : les colonnes `prospection_login_token*` dans Supabase
  `tenants` restent utilisées par `/api/auth/token` — ne pas toucher.

**Ce qui n'a PAS été touché côté Prospection** : ni `/api/tenants/provision` ni
`/api/auth/token`. Le flow signup auto continue de marcher exactement pareil.

## 🔍 À auditer — appels auto-référents via URL publique (2026-05-08)

> Découvert sur Notifuse pendant fix DETTE-001 CrowdSec : Notifuse s'auto-appelle
> via URL publique (Cloudflare round-trip) → 480k req/jour inutiles. Voir
> [`../notifuse/TODO.md`](../notifuse/TODO.md#-dette-détectée--2026-05-08-1415).
>
> **Prospection a `APP_URL=https://prospection.app.veridian.site` ET `NEXTAUTH_URL=https://prospection.app.veridian.site`** — risque modéré.

- [ ] `grep -rn "APP_URL\|NEXTAUTH_URL\|env.APP_URL\|process.env.APP_URL" prospection/src` pour lister les usages
- [ ] Identifier les **jobs cron** (Inngest, scheduled tasks, scrapers en arrière-plan) qui pourraient s'auto-appeler :
  - Inngest event handlers (vérifier la config — Inngest utilise normalement son propre serve URL)
  - Cron jobs `node-cron` ou similaire
  - Scrapers SIRENE / API entreprises (légitime, vers APIs externes)
  - Twenty sync (server-to-server vers `twenty.app.veridian.site`, pourrait être interne en `http://twenty-server:3000`)
- [ ] Vérifier les retry handlers et webhook receivers
- [ ] Mesurer impact : count hits `prospection.app.veridian.site/*` depuis 172.17.0.1 dans les access logs Traefik

**Probabilité que Prospection soit affecté** : 🟡 moyenne. Si Inngest est branché,
il utilise typiquement son propre endpoint isolé. Mais si du code custom appelle
`fetch(\`\${APP_URL}/api/...\`)` pour des jobs, c'est le même bug que Notifuse.

## Architecture

```
prospection/
├── src/
│   ├── app/              # Next.js 15 App Router
│   ├── lib/
│   │   ├── supabase/     # LEGACY (auth + tenants) — a migrer (chantier douloureux)
│   │   ├── prisma/
│   │   └── lead-quota.ts # Distribution freemium par score_dept
│   └── components/
├── prisma/
│   └── schema.prisma     # ⚠️ db push actuellement, a passer en Prisma Migrate (P1.7)
├── e2e/
│   ├── core/             # a separer en core/extended (P2.8)
│   └── extended/
└── scripts/              # SQL manuels — a supprimer apres P1.7
```

## Sprint en cours

### P0 — Urgences
- [x] **P0.1** checkTrialExpired recable proprement (lookup tenant via workspace_members, cache 5min)
  - **2026-04-10 10h30** : lookup user_id direct → fallback workspace_members, cache 5min dans `src/lib/trial.ts`, plans `pro`/`enterprise` jamais expires (Stripe = source de verite), 6 tests unit vitest (`trial.test.ts`) + guard admin-API toujours vert
- [x] **P0.2** Audit hot paths : cache 5min confirme dans `src/lib/supabase/tenant.ts:109-160` (getTenantProspectLimit via `planCache`)
- [x] **P0.4** Integration tests flaky : fix propre
  - **2026-04-10 10h30** : root cause = collision SIREN (9 chars dispo, `998${RUN_ID(6)}X` puis `.slice(0,9)` coupait le suffixe donc SIREN_A === SIREN_B === SIREN_SHARED). Fix : RUN_ID=5 chars, slice enleve, SIRENs garantis uniques. Tests re-actives en parallele en CI (prefixes tenant_id + SIREN disjoints entre fichiers). `continue-on-error` retire, `integration` remis dans `needs` du promote. 3 runs locaux consecutifs verts avec DB fraiche
- [x] **P0.5** Build CI OK avec `next@^15.5.14` (package.json:33, derniers runs verts)
- [ ] **P0.6** Finir pricing : payant geo 20EUR, payant full 50EUR, achat par lot, UI onboarding
  - **Audit 2026-04-10** : paywall modal existe (`src/components/layout/paywall.tsx`) mais affiche Pro 29EUR / Enterprise 49EUR (plans hub genericos), pas les SKUs geo/full specifiques. Checkout wire via env (`src/app/api/checkout/route.ts`). Onboarding freemium zones/secteur existe (`src/components/layout/onboarding.tsx`). **Manque** : SKUs geo/full, flow achat par lot 100 leads=10EUR, UI selection zone/secteur post-paiement

### P1.1 — Appliquer le standard cross-SaaS
> Prospection = app de reference pour les standards. Ce qui manque ici est ajoute d'abord
> puis replique dans les autres apps.
- [ ] Auditer contre `docs/saas-standards.md` (cree en P1.1)
- [ ] Soft delete sur `tenants` + `workspace_members` (+ cron purge 30j)
- [ ] Audit log sur les actions sensibles
- [ ] Health check `/api/health` conforme

### P1.6 — Nettoyage workspaces + isolation membres
- [ ] Roles internes calques Twenty : `owner`, `admin`, `member`, `viewer`
  - `member` : CRUD leads assignes, read-only sur les autres
  - `viewer` : read-only workspace
  - `admin` : comme owner sauf delete workspace
  - `owner` : full
- [ ] Endpoint `DELETE /api/tenants/:id` (HMAC Hub) avec soft-delete cascade
- [ ] Cron purge definitive apres 30j (leads, outreach, pipeline, notes)
- [ ] Page `/admin/members` : liste, invite, change role, remove
- [ ] Middleware filtrage : queries prospects/outreach/pipeline par `workspace_id` + role
- [ ] Tests e2e multi-users : member ne voit pas les leads d'un autre, viewer read-only
- [ ] **Entree UI-REVIEW** a creer apres livraison

### P1.7 — Prisma Migrate + API sync data (main agent only)
> ⚠️ NE PAS DELEGUER. Main agent uniquement, etape par etape, validation Robert entre chaque.
- [ ] `npx prisma migrate dev --name init` pour baseline depuis schema actuel
- [ ] Tester en local sur DB vide
- [ ] `npx prisma migrate deploy` dans Dockerfile (au start, avant l'app)
- [ ] Tester en staging
- [ ] Appliquer en prod (accord Robert, backup avant)
- [ ] Supprimer `prospection/scripts/*.sql` (archiver dans git history)
- [ ] `POST /api/internal/sync-data` HMAC, upsert batch, rate limit 10 req/min, batch max 1000
- [ ] Script `sync.ts` dans scraping qui appelle l'API au lieu de COPY FROM
- [ ] Tester flow complet : scraping enrichit → API sync → DB mise a jour

### Setup dev rapide (à implémenter)
> **URGENT** — Actuellement monter un env dev prend 45min+ à cause de : pas de SSH dev→prod,
> tunnel local nécessaire, pg_dump/restore lent, Prisma db push qui casse le schema.
- [ ] Exposer la DB prod sur Tailscale (pg_hba.conf + port 15433 bindé à 100.88.202.29) — accès direct depuis dev server
- [ ] Script `make dev-env` : tunnel + rsync + next dev en une commande
- [ ] Alternative : réplication logique Postgres prod→dev (streaming, toujours à jour)
- [ ] **REGLE** : JAMAIS de `prisma db push` sur une copie de la DB prod — ça drop des colonnes

### Regroupement multi-SIRET par dirigeant
> Un gérant avec 3 boîtes = 3x le potentiel commercial. Afficher les entreprises liées dans la fiche prospect.
- [ ] Requête : trouver les entreprises qui partagent le même dirigeant_nom+dirigeant_prenom
- [ ] UI : section "Autres entreprises de ce dirigeant" dans la fiche prospect
- [ ] Enrichissement : l'API recherche-entreprises retourne `nombre_etablissements` — utiliser ça comme indicateur

## Backlog Prospection-specific

- [ ] twenty.ts getQualifications : verifier SIREN→web_domain en staging
- [ ] /segments/rge/sans_site : root cause serveur (body vide)
- [ ] DB locale postgres:5433 pas migree → documenter `npm run db:fresh:siren`
- [ ] Tests e2e manquants (P2.1) :
  - [ ] pipeline-kanban.spec.ts (drag & drop statuts)
  - [ ] phone-call-flow.spec.ts (Telnyx SIP)
  - [ ] stripe-paywall.spec.ts (trial expired → paywall)
  - [ ] claude-ai-flow.spec.ts (note Claude, delete)
  - [ ] global-full-flow.spec.ts (parcours complet)
- [ ] Tests API smoke (P2.2) : prospects, segments, stats, outreach, twenty

## Dette technique post-migration Auth.js v5 (2026-05-06)

> Lors de la migration Supabase Auth → Auth.js v5, plusieurs raccourcis ont
> été pris pour livrer rapidement. À traiter en P2 dans une session future.

### Fallbacks Supabase admin légacy à retirer (Phase 8 cleanup)
- 7 fichiers ont encore des imports `@/lib/supabase/tenant` ou
  `admin.auth.admin.getUserById` en fallback :
  - `src/app/api/admin/members/route.ts` (ligne ~108-131) — fallback enrich email
  - `src/app/api/admin/invitations/[id]/route.ts` (ligne ~54)
  - `src/app/api/trial/route.ts` (ligne ~28) — actuellement stub `return false`
  - `src/app/api/checkout/route.ts`, `phone/telnyx-token`, `outreach/test-send`
  - `src/lib/supabase/{tenant,server,api-auth,user-context}.ts` (compat layer)
- À retirer après que tous les vrais clients soient migrés (Phase 8)

### `trial.ts` est un stub temporaire
- `checkTrialExpired` retourne toujours `false` (hack 2026-04-06 incident
  rate-limit Supabase)
- À recâbler sur Stripe (source de vérité billing) ou sur les colonnes
  `trial_ends_at` + `prospection_plan` qui ne sont **pas encore** dans le
  modèle Prisma `Tenant` local
- Voir P0.6 et P1.1

### Tenant Prisma local incomplet
- Le modèle `Tenant` Prisma actuel ne contient pas toutes les colonnes
  Supabase (manque : `lead_score`, `trial_ends_at`, `cleanup_notified_at`,
  `prospection_api_key`, `prospection_login_token*`, `prospection_plan`,
  `prospection_config`, `prospection_provisioned_at`)
- Le script `migrate-supabase-to-authjs.ts` ne migre que les colonnes
  communes (Twenty + Notifuse + base SaaS)
- À ajouter au schema Prisma + re-migrer si on veut la parité fonctionnelle
  complète

### FK entreprises sautée sur DB mirror dev
- Pendant le test ultime sur dev mirror, les FK `outreach.siren →
  entreprises.siren` et autres ont été droppées pour éviter de restaurer
  les 996K entreprises
- Pas de problème en prod (FK existent), juste un artifact du test mirror

### Tests CI insuffisants (rapport audit subagent 2026-05-06)
La CI couvre ~70% de "l'app fonctionne", 0% de "l'auth est sécurisée".
Flows critiques NON testés en e2e :
- Password reset (Auth.js v5 change le flow vs Supabase magic link)
- Signup nouvel user (rate-limit interdit en CI)
- Session expiry + refresh JWT
- Logout complet (cookies + cache + revoke serveur)
- Invited member set password 1ère fois (happy path testé, edge cases non)

À ajouter en P2.1 — voir [`tmp/PROSPECTION-AUTH-MIGRATION.md`](../../../tmp/PROSPECTION-AUTH-MIGRATION.md)

### MFA absente de Prospection
- Hub a MFA email Brevo, Prospection non (simplifié pendant migration)
- À évaluer : opt-in cohérence multi-app ou pas

### Endpoints HMAC orchestration non créés
- Phase 3 du plan : `POST /api/internal/{users/upsert,tenants/provision,
  tenants/suspend,magic-link/issue}`
- Pas critique pour livrer l'auth locale, mais nécessaire pour future
  orchestration Hub → Prospection (magic link cross-app)

### Tests e2e multi-tenant incomplets
- Le spec `e2e/extended/multi-tenant-data-integrity.spec.ts` existe mais la
  fixture `tenants-prod.json` n'a pas de passwords (exclu volontairement
  pour sécurité)
- Pour tester réellement post-migration, il faut soit utiliser des
  comptes de test Robert dont on a les MDP, soit passer par une session
  injectée via cookie

## Bugs connus

- [x] ~~Integration tests flaky en CI (workaround `continue-on-error`)~~ — fix 2026-04-10 (P0.4)
- [ ] Pas de confirmation email au signup (geré par Supabase, cassera a la migration)

## Decisions techniques

- **Postgres dediee** : Prospection a deja sa propre Postgres (staging + prod), separee de Supabase
- **Distribution freemium `score_dept`** : lead-quota.ts calcule la repartition selon la densite
  d'entreprises par departement → les gros departements consomment plus de leads du freemium 300
- **Tests e2e sequentiels** : `--fileParallelism=false` a cause du flaky integration (a fixer P0.4)
- **SIRENs dynamiques 998/999** : prefix dedies aux tests pour eviter les conflits avec la vraie DB

## Notes agents (chantiers en cours)

**2026-04-14 — Etat fin de session**
- Enrichissement API gouv : 2 workers morts (tunnel SSH down), ~29K/997K enrichis
  → relancer : `ssh -fN -L 100.103.69.21:15433:127.0.0.1:15433 prod-pub` puis `nohup python3 /tmp/enrich-birth-dates.py > /tmp/enrich-worker-0.log 2>&1 &`
- P1.1 commits (deleted_at, audit_log) : `deleted_at` maintenant en prod (fixé en urgence), `audit_log` table pas encore creee
- Worktree `/home/brunon5/Bureau/veridian-platform-prodsnap/` a nettoyer (`git worktree remove`)
- Dev server Next dev probablement down (a relancer si besoin)

**A faire prochaine session :**
- **PWA + Push Notifications** (priorité Robert 2026-04-14) :
  - PWA installable sur mobile (manifest.json, service worker, icônes)
  - Push notifications pour rappels pipeline (stage `a_rappeler` → notif à la date/heure)
  - Push notifications pour démos planifiées (stage `site_demo` → notif veille + jour J)
  - Push notifications quand un nouveau lead est assigné
  - Calendrier interne intégré (déjà un CalendarDialog, à connecter au push)
  - Objectif : Robert reçoit une notif sur son iPhone quand il doit rappeler un prospect
  - Infra push : VAPID keys partagées avec Analytics (même pattern), Web Push API
  - Table `PushSubscription` dans le schema Prisma prospection
  - Endpoint `/api/push/subscribe` + `/api/push/send`
  - Service worker `public/sw.js` avec cache offline + push listener
  - Script `/api/cron/check-reminders` (appelé par Dokploy schedule) qui envoie
    les notifs pour les rappels due dans les prochaines 15 min
- Vue calendrier pipeline (quand deadlines seront renseignees par les commerciaux)
- Bouton toggle calendrier dans le pipeline header
- Tresorerie INPI (enrichissement — data dispo dans l'API INPI)
- Relancer enrichissement workers
- Backup cron automatique Dokploy (pg_dump quotidien)
- DB prod read-only pour dev (user PG ro + Tailscale)
- Nettoyer worktree git

## Recently shipped

- **2026-04-14** — feat: bouton Modifier sur bandeau pipeline (reouvre modal du stage actuel)
- **2026-04-14** — fix: recherche SIRET 14 chiffres → extrait SIREN 9 premiers
- **2026-04-14** — fix: pipeline values Number() au lieu de string concatenation
- **2026-04-14** — fix: DB prod deleted_at manquant → ajout colonnes + restart container
- **2026-04-14** — fix(test): e2e core — nouveaux stages pipeline + health status "ok"/"healthy"
- **2026-04-14** — fix(ci): health check accepte "ok" ET "healthy" — root cause des deploy failures
- **2026-04-14** — feat: bandeau etat pipeline + derniere note sur la fiche prospect
- **2026-04-14** — feat: historique notes (prepend avec separateur, pas d'ecrasement)
- **2026-04-14** — feat: bouton archives dans le pipeline header
- **2026-04-14** — feat: pipeline commercial 8 stages + modals de transition par stage
  - Stages : fiche_ouverte → repondeur → a_rappeler → site_demo → acompte → finition → client → upsell
  - Modals contextuels : repondeur (message oui/non), rappel (date/heure), site demo (interet 0-100%, date, prix), acompte (devis, %, recurrent)
  - Jauge interet graduee + animation glow/pulse >80%
  - Barre urgence 7j sur stages auto-archive
  - Valeur pipeline : Pipe estime | Encaisse | Signe | Recurrent/mois
  - Bouton X archiver optimiste sur chaque card
  - Drag & drop entre stages → ouvre modal transition
  - DB : 12 colonnes ajoutees sur outreach + migration data existante
- **2026-04-14** — feat: refonte lead-sheet complete
  - 2 cards (Contact + Entreprise), secteur en bandeau
  - Tel formate gros, emails, dirigeant + age + date creation
  - Sites multi-domaines avec score dette tech + prestataire concurrent (Solocal badge)
  - Indicateurs HTTPS/responsive/copyright avec tooltips commerciaux
  - Boutons Google Maps + Google Calendar avec logos SVG + labels
  - QuickNotes (popover auto-save, presets, surbrillance si note existante)
  - Reseaux sociaux (LinkedIn/Facebook/Instagram)
  - Alerte BODACC (liquidation/redressement)
  - Fallback CA → resultat net quand pas de CA
  - Section Finances refaite : cards metriques, graphique barres 5 ans, tableau YoY
- **2026-04-14** — feat: recherche trigram (indexes GIN, bypass filtres en mode recherche)
- **2026-04-14** — chore: web_agency migre (33K leads, Solocal 11K)
- **2026-04-14** — chore: enrichissement API gouv lance (naissance, etat admin, etablissements, CC)
- **2026-04-14** — chore: open-data/ dans le monorepo + TODO/VISION formalises
- **2026-04-14** — chore: backup prod 373M envoye sur dev server

- **2026-04-10 10h30** — P0.1 : `checkTrialExpired` recable (lookup tenants direct + fallback workspace_members, cache 5min, plans payants exemptes), 6 tests unit + guard admin-API (`src/lib/trial.ts`, `src/lib/trial.test.ts`)
- **2026-04-10 10h30** — P0.4 : integration tests fixes (collision SIREN root cause — `slice(0,9)` coupait le suffixe sur un prefixe 3+6=9 chars). 3 runs verts en parallele, `continue-on-error` retire, integration re-ajoute dans `needs` du promote
- **2026-04-10** — P0.2 verifie : `getTenantProspectLimit` cache 5min en place (tenant.ts:109-160)
- **2026-04-10** — P0.5 verifie : next@15.5.14 en place, build CI vert
- **2026-04-07** — Pipeline-board JS crash fix (`b?.length || 0`)
- **2026-04-07** — Login timeout global-full-flow 20s → 30s
- **2026-04-07** — Warm-up staging avant Playwright (evite cold start)
- **2026-04-07** — CVE next@15.5.14 installe (build CI a verifier P0.5)
- **2026-04-06** — 30+ e2e specs, admin pages, Stripe wire, INPI v3.6
- **2026-04-06** — Self-hosted runner installe, docker build 25s, deploy 11s
