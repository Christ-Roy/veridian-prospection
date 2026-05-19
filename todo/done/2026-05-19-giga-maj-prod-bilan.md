# Bilan giga-MAJ prod 2026-05-19

> **Session** : 14h00–18h40 (~4h30)
> **Validé en prod par** : Robert ("go prod" + "j'ai vu aucun problème c'est clean")
> **Image prod déployée** : `sha256:2784401b8fcf` (commit `ffe7947`)
> **Précédente prod** : `sha256:19d4d1c231f1` (commit `4bde7af`, déployé matin)

## Ce qui est livré en prod

### Endpoints Hub-contract §5

| Endpoint | État | Migration DB | Tests |
|---|---|---|---|
| `POST /api/tenants/provision` | ✅ HMAC standard `{ts}.{body}` + legacy 30j | — | 11 tests |
| `POST /api/tenants/update-plan` | ✅ whitelist + immunité plan_source | 0004 | 11 tests |
| `POST /api/tenants/attach-owner` | ✅ additif, ne downgrade jamais | — | 12 tests |
| `POST /api/tenants/suspend` | ✅ idempotent + webhook | — | 10 tests |
| `POST /api/tenants/resume` | ✅ idempotent + webhook | — | 10 tests |
| `GET  /api/tenants/[id]/health` | ✅ magic_link_capable cohérent | — | 8 tests |
| `POST /api/tenants/[id]/soft-delete` | ✅ deletedAt + purgeEligibleAt + webhook | 0005 | 11 tests |
| `POST /api/tenants/[id]/restore` | ✅ → suspended (jamais → active) | — | 7 tests |
| `POST /api/tenants/[id]/purge` | ✅ 5 garde-fous + cascade DELETE + audit GDPR | — | 11 tests |
| `GET  /api/tenants/[id]/usage-summary` | ✅ agrégats par table tenant-scoped | — | 8 tests |

**Total** : 99 tests Hub-contract verts en prod (suite complète 429 verts).

### Migrations Prisma appliquées en prod

- `0001_init` → baselined (déjà appliqué pré-Prisma)
- `0002_add_tenant_id` → baselined
- `0003_composite_pk_multi_tenant` → baselined
- `0004_hub_contract_plan` → **appliqué** (plan + plan_source + table veridian_plan_history)
- `0005_hub_contract_lifecycle` → **appliqué** (purge_eligible_at + last_touched_at + purged_at + index partiel)

### CI/CD

- ✅ Step `Run prisma migrate deploy (staging DB)` câblée dans `prospection-deploy-staging.yml`
  via container node:22-alpine éphémère (le runtime app vire npm pour CVE hygiene).
- ❌ Step équivalente manquante côté `prospection-ci.yml` (prod) — fallback : application
  manuelle via SSH + container éphémère sur réseau `dokploy-network`.
- ✅ Husky message anti-bâclage tests dans 5 repos Veridian.

### Doc

- `docs/hub-contract.md` créée (référence HMAC + curl reproductible + matrice ENV).
- `CLAUDE.md` Prospection : bloc en tête "Promotion prod = STRICTEMENT HUMAINE".
- CI-ARCHITECTURE.md §18 + §19 rédigées (source dans `todo/`, à patcher côté Hub par
  l'agent Hub via ticket `veridian-hub/todo/2026-05-19-ci-architecture-etoffer.md`).

## Validations effectuées

1. **Smoke staging avec DB clonée prod** (2026-05-19 ~17h45) : 24 scénarios pass
   incluant une purge réelle GDPR sur le tenant `antjacquet` (1 outreach + 1 workspace
   + 1 member supprimés en cascade, audit GDPR garde le tenant avec PII nullées).
2. **Smoke prod post-bascule** : update-plan, soft-delete, usage-summary, health
   répondent propres (404 / 200 selon le tenant) sur les 11 tenants réels prod.
3. **Tenant Robert prod** : `status:active, plan:freemium, magic_link_capable:true,
   members_count:1, 9 outreach réels` via `/health` + `/usage-summary`.
4. **Vérification visuelle login** par Robert : "j'ai vu aucun problème c'est clean".

## Incidents résolus pendant la session

1. **Migration 0004/0005 jamais appliquée en prod** → bombe à retardement résolue
   (update-plan retournait 500 P2022 silencieusement avant)
2. **Cron e2e-cleanup KO depuis 5j (hostname obsolète)** → supprimé (legacy Supabase)
3. **CI staging cassée par privatisation Tailscale** → step `tailscale/github-action@v3`
   ajoutée
4. **DB staging clonée sans `_prisma_migrations`** → baselined les 5 migrations
5. **3× Dokploy webhook silent fail** → force compose.deploy via API (pattern
   documenté dans memory)

## Reste à faire (visible dans `todo/` actif)

- `2026-05-19-hub-contract-conformity.md` — Phases 3 + 6.5 + 7 + 8 du contrat (P3
  generateMagicLink, tenant.touched, integration test, observability)
- `2026-05-19-dette-technique-audit.md` — 8 priorités sur 4 sprints (Supabase cleanup,
  refactor gros fichiers, etc.)
- `2026-05-19-ci-architecture-sections-18-19.md` — source markdown à patcher côté Hub
- `2026-05-19-v13-multi-membre-cross-app.md` — v1.3 sync-member (futur)

## Tickets cross-app déposés (à traiter par les agents respectifs)

- `veridian-hub/todo/2026-05-19-prospection-conformity.md` — migration HMAC client Hub
- `veridian-hub/todo/2026-05-19-ci-architecture-etoffer.md` — patch CI-ARCHITECTURE.md
- `veridian-hub/todo/2026-05-19-auto-promote-staging-main.md` — câbler auto-promote Hub
- `veridian-analytics/todo/2026-05-19-auto-promote-staging-main.md` — câbler Analytics

## Mémoires créées (session)

- `project-prospection-prod-strict-human` — règle anti-promote agent
- `project-prospection-dokploy-webhook-fail` — pattern force redeploy
- `project-prisma-migrate-pattern` — container Prisma éphémère
- `feedback-sabotage-test-audit` — méthode anti-tests-bâclés
- `project-dette-technique-2026-05-19` — pointeur vers ticket dette
