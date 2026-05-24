# [PROSPECTION] Helper E2E `captureConsoleErrorsAfterLogin()` — bétonner le pattern listener post-login

> **Type** : Dette technique / robustesse E2E
> **Sévérité** : 🟢 P2 — pas urgent, mais évite que le bug 401 du dashboard-crawler se reproduise sous une autre forme dans les futurs specs.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23

## Contexte

Le bug fixé dans `done/2026-05-23-fix-401-api-routes-clientside-auth.md`
(commit `67d7e38`) venait d'une cause précise et **généralisable** :

> Si tu attaches `page.on("console", …)` AVANT `loginAsE2EUser`, tu captures
> les 3 × 401 légitimes de `AppNav` + `TrialProvider` qui se montent dès
> `/login` (root layout `src/app/layout.tsx:59`). Ces 3 fetches au mount
> n'ont pas encore de cookie session → erreurs console → faux positifs.

Le crawler `dashboard-crawler.spec.ts` est fixé, mais **n'importe quel
futur spec qui capture les console errors va retomber dans le même piège**
s'il n'a pas connaissance de cette subtilité. C'est de la dette de
convention non écrite.

## Proposition

Ajouter un helper dans `e2e/helpers/auth.ts` (ou un nouveau
`e2e/helpers/console.ts`) :

```ts
/**
 * Attache un listener `console.error` à la page APRÈS un login. Les erreurs
 * survenues avant le retour de cette fonction sont ignorées par design : le
 * passage par /login monte AppNav + TrialProvider depuis le root layout,
 * qui fetch /api/me /api/trial /api/settings sans cookie → 3 × 401
 * légitimes (cf incident done/2026-05-23-fix-401-api-routes-clientside-auth.md).
 *
 * Utiliser ce helper plutôt que `page.on("console", …)` direct dans tout
 * spec qui assert sur l'absence d'erreurs console.
 */
export function captureConsoleErrorsAfterLogin(
  page: Page,
  ignorePatterns: RegExp[] = [],
): { errors: string[] } { … }
```

## DoD

- [ ] Helper exporté + JSDoc qui explique le pourquoi (lien vers ticket
  fixé).
- [ ] `dashboard-crawler.spec.ts` refactoré pour utiliser le helper
  (suppression du listener inline).
- [ ] Au moins 1 autre spec existant qui assert sur console errors migré
  (à grepper).
- [ ] Sabotage-test du helper : usage incorrect (listener inline) doit
  être détectable visuellement à la review — ou mieux, un commentaire
  dans `e2e/helpers/auth.ts` qui dit "n'utilise PAS page.on('console')
  inline, passe par captureConsoleErrorsAfterLogin()".

## Effort estimé

30 min — refactor mécanique + 1 grep `page.on("console"` dans `e2e/`.

## Pas P1 parce que

Le seul spec impacté est le crawler, déjà fixé en dur. Les autres specs
testent des comportements applicatifs, pas la propreté console. Mais le
jour où on en ajoute un sans connaître cette histoire, on perdra 1h à
re-diagnostiquer.
