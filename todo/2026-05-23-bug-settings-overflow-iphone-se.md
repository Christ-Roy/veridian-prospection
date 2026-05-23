# [PROSPECTION] Bug responsive — /settings overflow horizontal sur iPhone SE (375px)

> **Type** : Bug UI responsive
> **Sévérité** : 🟡 P1 — bloque l'usage mobile de /settings, page importante (config user)
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-17-specs pendant validation `mobile-viewport.spec.ts` migration

## Symptôme

Sur iPhone SE (viewport 375px), la page `/settings` a un `scrollWidth=757px` (vs `innerWidth=375px`). **Overflow horizontal de 382px** → page non utilisable au scroll vertical normal.

Reproduit en E2E par `e2e/extended/mobile-viewport.spec.ts:84` (test viewport iPhone SE qui asserte `scrollWidth <= innerWidth + 1`).

## Cause probable

Un composant dans `/settings` a une `width: 757px` fixe OU une `table` non-responsive OU une `grid` non-collapsable sous `md`. À grep dans `src/app/settings/` + `src/components/dashboard/settings-*.tsx`.

Suspects probables :
- `settings-form.tsx` — peut avoir un layout 2 colonnes non-collapsé mobile
- `settings-display.tsx` ou `settings-reference.tsx` — peuvent avoir des tableaux
- `settings-telephony.tsx` ou `settings-call-routing.tsx` — peuvent avoir des éléments larges
- `settings-tabs.tsx` — peut avoir un overflow de tabs

## Fix attendu

1. Grep `src/app/settings/` + `src/components/dashboard/settings-*` pour patterns suspects :
   - `w-[Npx]` avec N > 375
   - `min-w-[Npx]` non collapsé sous `md`
   - `table` sans `overflow-x-auto` wrapper
   - `grid-cols-N` sans variant responsive (`md:grid-cols-N` au lieu de `grid-cols-N`)
2. Appliquer le fix (probablement `overflow-x-auto` sur un wrapper OU collapse layout sous `md`)
3. Vérifier en Chrome MCP à 375px que le scroll horizontal disparaît
4. Le test `mobile-viewport.spec.ts` doit passer sans modif

## Effort

~1-2h (grep + fix + smoke responsive)

## Périmètre

`src/app/settings/` + `src/components/dashboard/settings-*.tsx` uniquement. Pas de logique business touchée.

## Référence

- Spec qui détecte : `e2e/extended/mobile-viewport.spec.ts:84`
- Rapport e2e-17-specs 2026-05-23 (commit `b8b33e9`)
