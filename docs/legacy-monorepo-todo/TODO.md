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
