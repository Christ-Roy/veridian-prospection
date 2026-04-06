# CI / CD Strategy — Prospection Dashboard

> Dernière mise à jour : 2026-04-05
> Auteur : session autonome Claude (lead CI/CD dans la team veridian-invite-flow)
> Complément : `docs/DEPLOY.md` (flow de deploy), `docs/TESTING.md` (tests locaux), `docs/ARCHITECTURE.md` (vue d'ensemble).

## Principes

1. **Bloquer le minimum, voir le maximum.** Ship fast, mais rien en prod sans qu'une sonde l'ait vue d'abord.
2. **Couches séparées.** Un fail sécurité ne doit pas bloquer un hotfix. Un fail perf ne doit pas bloquer une feature. Mais chaque couche doit remonter de la visibilité (artifact, annotation, summary).
3. **Anti-régression strict sur le happy path.** Les routes critiques (`/api/health`, `/api/status`, `/login`, `/prospects`) DOIVENT rester vertes en permanence.
4. **Non-déterminisme interdit.** Les tests e2e qui flakent > 5 % sont taggués `@flaky` et sortis du gate bloquant immédiatement.
5. **Fraîcheur des tests.** Un spec qui n'a pas bougé depuis 30+ jours alors que le code sous-jacent a été refactoré est suspect → rapport staleness hebdo.

## Couches CI

### Couche 1 — Gate bloquant (correctness)

Workflow : `.github/workflows/ci.yml` jobs `build` + `integration` + `e2e-staging-fast`.
Budget temps : **< 4 min** cumulés pour le gate complet avant deploy.

Contenu minimum :
- `tsc --noEmit` (type-check strict, 15–30 s)
- `eslint src/ --quiet` (warnings OK, errors bloquent, 10 s)
- `vitest run src/` (unit tests colocated, actuellement 23 tests en 800 ms)
- `vitest run e2e/integration/` (tests Prisma contre Postgres éphémère CI, 30–60 s)
- `e2e-staging-fast` (à créer dans le refactor post-démo) : 1 seul spec Playwright qui fait login + `/prospects` charge + `/api/status` répond healthy. < 60 s.

**Règle** : si ce gate passe vert, le deploy staging part. Si rouge, le lead revert immédiatement le commit coupable ou assigne le fix.

### Couche 2 — Gate non-bloquant (coverage complète)

Workflow : `.github/workflows/ci.yml` job `e2e-staging-full` (post-deploy, ne bloque pas le deploy lui-même, mais annote le run si fail).
Budget temps : jusqu'à 10 min.

Contenu :
- Les 14+ specs Playwright browser chromium actuels (`e2e/ui-siren-smoke.spec.ts`, `e2e/admin-pages-smoke.spec.ts`, `e2e/lead-detail-interactions.spec.ts`, `e2e/status-endpoint.spec.ts`, `e2e/search-prospects.spec.ts`, `e2e/client-error-boundary.spec.ts`, `e2e/segments-filter.spec.ts`, `e2e/keyboard-shortcuts-help.spec.ts`, `e2e/historique-page.spec.ts`, `e2e/filters-persistence.spec.ts`, `e2e/settings-page.spec.ts`, `e2e/mobile-viewport.spec.ts`, + les nouveaux de la démo invite-flow).
- `scripts/test-dashboard-api.ts` (smoke API authentifié 15 routes métier).
- `scripts/test-invite-api.ts` (smoke API invitation flow, post-démo).
- `scripts/test-admin-routes.ts` (admin API vitest).

**Règle** : un fail dans cette couche n'annule PAS le deploy, mais pose une annotation GitHub et upload les screenshots. Le lead investigue dans l'heure qui suit.

### Couche 3 — Sécurité (non-bloquant, daily)

Workflow : `.github/workflows/security.yml`. Trigger : push staging/main, schedule daily 06:15 UTC, manual dispatch.
Budget : hors du chemin critique deploy.

Contenu :
- `npm audit --omit=dev --json` — vulns dans les deps prod
- `semgrep ci` avec `p/owasp-top-ten`, `p/javascript`, `p/typescript`, `p/react`, `p/nextjs`, `p/secrets`
- `trivy fs` sur `dashboard/` — vulns deps + image base
- `gitleaks` sur full history — secrets leaked

**Sortie** : artifacts `npm-audit-report`, `semgrep-report`, `trivy-report`, SARIF uploadés dans GitHub Security tab.
**Dette tracking** : `docs/SECURITY-DEBT.md` édité à la main quand on triage les findings (ou régénéré par un script futur).

### Couche 4 — Performance (non-bloquant, post-deploy + schedule)

Workflow : `.github/workflows/perf.yml`. Trigger : après `CI / CD` workflow success sur staging, schedule toutes les 6 h, manual dispatch.

Contenu :
- `scripts/perf-smoke.ts` — hit 10+ routes API 8x chacune avec session Supabase réelle, rapporte p50/p95/p99/max, fail si p95 > 3 s ou p99 > 6 s. Artifact JSON + MD.
- `lhci` (Lighthouse CI) sur `/login` (page publique) — warn si performance score < 70.

**Règle** : un fail n'annule pas le deploy. Le lead investigue si :
- une route passe de p95 = 200 ms → 2 000 ms entre 2 deploys consécutifs (régression franche)
- une nouvelle route dépasse 3 s dès son premier run (loop ou query non-optimisée)

### Couche 5 — Health monitoring continu (hors CI, déjà en place)

Scripts bash sur `/opt/veridian/monitoring/` du dev server + VPS prod. Healthcheck toutes les 5 min vers `/api/health` et `/api/status`. Alerte Telegram si 3 checks consécutifs fail.

## Job layout `ci.yml` cible

```
build           (5 min, bloquant)
  └─ tsc + eslint + npm ci + next build
integration    (1 min, bloquant)
  └─ vitest integration Postgres éphémère
docker-staging  (3 min, bloquant)
  └─ build GHCR + push :staging tag
deploy-staging  (1 min, bloquant)
  └─ Dokploy API redeploy + wait healthy
e2e-staging-fast (1 min, bloquant)  ← à créer
  └─ 1 seul spec smoke critique
e2e-staging-full (6 min, non-bloquant) ← rename de l'actuel e2e-staging
  └─ 14+ specs Playwright + API smoke + vitest admin
---
docker / deploy-prod / e2e-prod / rollback-prod (flow main, inchangé)
```

## Protocole anti-régression

1. **Pré-commit (lead + teammates)** : `npx tsc --noEmit && npx eslint src/ --quiet && npx vitest run src/` doit être vert localement. Obligation pour chaque teammate.
2. **Pré-push** : le lead `git log --oneline origin/staging..HEAD` avant de push, vérifie qu'il comprend chaque commit.
3. **Post-push** : `gh run watch` pour suivre le run en live. Si un job fail, le lead :
   - Identifie le commit coupable via `git log --oneline` + logs du job
   - Soit revert immédiatement (`git revert <sha> && git push`), soit assigne un fix à un teammate via `SendMessage`.
4. **Pas de push sur main** sans que staging soit vert depuis > 10 min ET que `e2e-staging-full` soit passé.
5. **Revert fast** : si un commit passe le gate bloquant mais casse un spec non-bloquant, et que le fix n'est pas trivial, on revert et on re-teste en PR plutôt que de laisser la branche polluée.

## Stratégie anti-flakiness

Un spec est flaky si : pass → fail → pass sur 3 runs consécutifs sans changement de code.

- 1er flake observé → le lead ajoute `test.describe.configure({ retries: 2 })` au spec en question
- 2e flake sur le même spec dans la semaine → marqué `@flaky` et sorti du gate bloquant (reste dans full)
- 3e flake → le teammate owner du spec doit fixer ou le supprimer

Les retries ne sont PAS un remède, juste un garde-fou. Le vrai remède est l'enquête.

## Staleness monitoring

Script : `dashboard/scripts/check-test-staleness.ts`.

Détecte les fichiers source (`src/components/**`, `src/lib/**`, `src/app/api/**`) modifiés plus récemment que leur test associé depuis > 7 jours.

À lancer :
- Manuellement avant chaque review de PR importante
- Ou automatiquement via un job GitHub Actions mensuel (non implémenté V1)

Sortie : `/tmp/test-staleness.md` avec :
- Liste des tests stale
- Liste des fichiers source sans test du tout
- Liste des up-to-date

## Métrique cible (3 mois)

- Gate bloquant < 4 min p95
- 0 flake en rolling 30 jours
- 0 secret leaked dans gitleaks
- 0 vuln critical dans npm audit prod
- p95 API staging < 2 s sur toutes les routes métier
- Lighthouse perf `/login` > 80
- Stale tests < 5 % du total

## Quand et comment revisiter cette stratégie

Tous les 2 mois, ou quand on ajoute un nouveau service (Hub, Twenty, Notifuse, etc.). Le lead CI/CD fait une passe :
1. Lire les derniers 50 runs `gh run list --limit 50`
2. Mesurer le temps moyen du gate bloquant
3. Lister les specs qui ont flake > 2 fois
4. Regarder `tmp/security-debt.md` et trier les findings par risque
5. Mettre à jour ce doc avec les apprentissages
