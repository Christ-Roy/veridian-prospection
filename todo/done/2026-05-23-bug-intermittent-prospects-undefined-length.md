# [PROSPECTION] Bug app intermittent — TypeError 'length' of undefined sur navigation depuis /prospects

> **Type** : Bug app — race condition chunk JS
> **Sévérité** : 🟡 P1 — reproduit en staging, donc présent en prod. Intermittent → utilisateurs voient parfois une page blanche au 1er chargement après navigation depuis /prospects.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-specs-supabase pendant validation `browser-flow.spec.ts` migration

## Symptôme

```
TypeError: Cannot read properties of undefined (reading 'length')
   at <chunk>/app/prospects/page-XXX.js (LR fn)
```

Reproduit sur `https://prospection.staging.veridian.site` (NODE_ENV=production, build complet).

**Scénario** : utilisateur charge `/prospects` une 1ère fois, puis navigue vers `/pipeline`, `/historique`, `/segments`, `/settings` ou `/leads/<domain>`. Sur la 1ère navigation, exception thrown → page peut être blanche / cassée.

**Comportement après retry** : refresh résout le problème (chunk JS finalement chargé). C'est pour ça que c'est intermittent et que personne ne l'a signalé en prod (l'utilisateur refresh sans comprendre).

## Pourquoi c'était invisible jusqu'ici

- Les utilisateurs en prod refresh sans le signaler comme bug
- Les tests unitaires Vitest ne chargent JAMAIS les chunks JS buildés
- Le crawler `dashboard-crawler.spec.ts` était cassé depuis 2026-05-22 (cf ticket crawler CI), donc on n'a pas vu en E2E non plus
- Les tests Playwright ont des retries auto qui masquent ce genre de race

C'est exactement le genre de bug que le ticket `2026-05-23-app-robustness-cadre.md` vise à attraper. Sans E2E flows entiers réels en CI, ce type de bug vit en prod indéfiniment.

## Hypothèses sur la cause

À investiguer (par priorité) :

1. **Le code-split FullCalendar/LeadSheet de `perf-pipeline` (commit `d1484df`)** charge ces composants en `next/dynamic({ssr:false})`. Un appel `something.length` sur une valeur asynchrone non encore résolue ?
2. **Hydration race entre le SSR (vide) et le CSR (data prosp asynchrone)** — un composant qui suppose `prospects.length` alors que `prospects === undefined` pendant le 1er render client.
3. **Cache prosp partagé entre routes** — `/prospects` warm le cache, les autres routes consomment avant que le cache soit ready.
4. **L'agent perf-pipeline a touché `pipeline-view.tsx` + `pipeline-board.tsx`** pour le code-splitting. La race peut venir du `mount-once` du `LeadSheet` (state `leadSheetOpened` + useEffect — cf commit `d1484df`).

## Investigation suggérée

1. **Reproduire systématiquement** :
   ```
   - Ouvre devtools, network tab, désactive le cache
   - Login sur https://prospection.staging.veridian.site
   - Va sur /prospects (laisse-le charger entièrement)
   - Clique sur /pipeline → observer console
   - Si pas d'erreur, retry depuis un autre point de départ
   ```
2. **Bisect commit** : pour confirmer si c'est `d1484df` (code-split) qui l'introduit, faire un test rapide :
   - `git checkout d1484df^` (un commit avant le code-split)
   - Build + smoke staging local (ou container Playwright dev-pub)
   - Si le bug n'apparaît pas → coupable identifié
3. **Source map** : le `page-XXX.js` est le chunk minifié. Activer les source maps en staging (`NEXT_PUBLIC_SOURCE_MAPS=1` au build ?) pour identifier la ligne source exacte.
4. **Sentry / observability** : a-t-on un Sentry ou équivalent qui aurait capturé l'erreur en prod ? Si oui, combien d'occurrences cette semaine ?

## Quick fix probable

Sans investigation poussée, le pattern défensif :
```ts
// Avant : prospects.length
// Après : (prospects ?? []).length OU prospects?.length ?? 0
```

À chercher dans `src/app/prospects/`, `src/components/dashboard/pipeline-*`, et tout composant qui consomme une liste async.

## Fix attendu

- Identifier le composant fautif (sourcemap ou bisect)
- Garde défensif `?? []` ou `?.length ?? 0` sur la valeur async
- Test Vitest qui reproduit le state non-résolu (assert que le composant ne throw pas)
- Smoke staging post-fix : navigation /prospects → /pipeline 10× sans erreur console

## Périmètre

App + tests. Pas un sujet d'infra ni de CI.

## Pas P0 mais P1 chaud

Pas P0 parce que :
- Résolu au refresh
- Pas de perte de données (juste une page blanche temporaire)
- Aucun utilisateur ne s'est plaint (qu'on sache)

Mais P1 parce que :
- Reproduit systématiquement en conditions tests = donc systématique en prod aussi
- L'expérience utilisateur perçue est "l'app a planté"
- Confiance utilisateur érodée

## Référence

- Découverte : rapport agent `e2e-specs-supabase` 2026-05-23 (suite migration `browser-flow.spec.ts`)
- Code-split suspect : commit `d1484df` (perf pipeline FullCalendar + LeadSheet dynamic)
- Lien avec robustesse : `todo/2026-05-23-app-robustness-cadre.md` chantier 2 (E2E flows)
