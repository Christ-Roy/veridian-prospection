# [PROSPECTION] E2E flaky sous pression staging — invite-flow + mobile-viewport

> **Type** : Investigation tests E2E (flakiness)
> **Sévérité** : 🟢 P2 — flaky qui passent au retry, pas bloquant immédiat. Mais à diagnostiquer pour la fiabilité long terme du crawler CI.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-17-specs (Phase 3 validation E2E, 2 flaky sur 43 tests)

## Symptôme

2 specs migrées passent en **flaky** sur dev-pub container Playwright (retry consommé, mais vert au final) :

1. `e2e/extended/invite-flow.spec.ts` — pression staging
2. `e2e/extended/mobile-viewport.spec.ts` — `/historique` iPhone SE, probable même cause

40 passed / 1 failed / 2 flaky sur 43 tests. Les autres specs migrées passent stable.

## Causes possibles à investiguer

1. **Rate-limit Auth.js** : si plusieurs tests parallel font signIn dans la même seconde, le rate limit hit. Vérifier `e2e/helpers/auth.ts` si `loginAsE2EUser` détecte les 429 et retry.
2. **Saturation `postgres-staging`** : container monoproc, IO bound sous load Playwright. Vérifier `docker stats` pendant un run.
3. **`networkidle` qui n'arrive jamais** (cf bug fix `fix-401-xhr` sur le crawler) : Auth.js polling useSession empêche networkidle. À transposer sur ces 2 specs aussi ?
4. **Hot reload bridge `ui-dev`** : si le crawler tape `ui-dev:3100` (hot reload) au lieu de `prospection-staging:3000` (image stable), Next.js dev compile à la 1ère requête (latence variable).

## Diagnostic suggéré

1. Lire les retries dans le rapport Playwright HTML — quelle erreur exacte au 1er try ?
2. Si rate-limit Auth.js → ajouter wait/sleep entre tests OU passer en `test.describe.configure({ mode: 'serial' })` sur les 2 specs
3. Si saturation DB → bumper RAM `postgres-staging` (cf §1 infra global, container actuel)
4. Si networkidle → appliquer le pattern `fix-401-xhr` (commit `67d7e38`) : remplacer `waitUntil:'networkidle'` par `'load'` + `waitForSelector('main')`

## Quick fix temporaire

Si pas de diagnostic immédiat : augmenter le retry count à 3 (au lieu de 2) sur ces 2 specs uniquement. Pattern :
```ts
test.describe.configure({ retries: 3 });
```

## Effort

- Investigation pour identifier la cause racine : ~2h
- Fix selon cause : ~1h

## Référence

- Rapport e2e-17-specs 2026-05-23 (Phase 3)
- Fix similaire fix-401-xhr (commit `67d7e38`) : listener APRÈS login + waitUntil 'load' + waitForSelector
