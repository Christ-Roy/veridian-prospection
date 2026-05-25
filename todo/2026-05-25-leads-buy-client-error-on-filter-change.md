# [PROSPECTION] /leads/buy plante client-side quand on change un filtre live

> **Type** : Bug UI critique
> **Sévérité** : 🔴 P0 — feature refill ICP cassée à l'usage live (page native /leads/buy = différenciateur produit livré en Vague 7b)
> **Owner** : agent Prospection à spawner
> **Créé** : 2026-05-25 par team-lead après mega battery baseline
> **Découvert par** : spec E2E `refill-icp.spec.ts:82:7 "3. preview se met à jour quand on change un filtre"`

## Symptôme

Sur https://prospection.staging.veridian.site/leads/buy :

1. L'user arrive sur la page (rend OK les 4 sections ICP visibles ✓)
2. Configure un filtre (ex : geo IDF, secteur Tech, employee range 10-50)
3. Change un filtre live (ex : ajoute un département, retire un secteur)
4. **L'app crash client-side** :

```
Application error: a client-side exception has occurred while loading
prospection.staging.veridian.site (see the browser console for more
information).
```

Page rendue vide, user perd toute sa config.

## Diagnostic à mener

1. Reproduire localement (ouvrir Chrome DevTools sur staging, console errors)
2. Identifier le composant fautif parmi les 8 livrés par W7b :
   - `SectorMultiSelect.tsx`
   - `GeoMultiSelect.tsx`
   - `EmployeeRangeSlider.tsx`
   - `RevenueRangeSlider.tsx`
   - `AgeRangeSelect.tsx`
   - `QualifierTagsSelect.tsx`
   - `LiveCountPreview.tsx` (debounce 300ms — suspect le plus probable)
   - `OrderSummaryCard.tsx`
3. Hypothèses :
   - State management React qui crash sur transition (ex : `undefined` accédé sur un filter pas encore initialisé)
   - Race condition entre debounce LiveCountPreview et changement filtre
   - SSR hydration mismatch (cf ticket sibling React #418)
   - Bug dans la lib `refill-icp/filters.ts` (Zod parse qui throw sur shape intermédiaire)

## Pourquoi pas détecté avant

W7b a livré 16 specs E2E hard-core sur refill-icp, dont 1 dédiée au changement de filtre. **Cette spec a fail dans la baseline mega battery** mais pas dans la CI staging Prospection Deploy Staging — donc la CI Prospection ne lance PAS la mega battery (`e2e/staging-full/*`), uniquement les unit Vitest.

Trou de couverture côté CI à régler (cf pilier 5 + ticket `2026-05-25-script-staging-full-database-url-manquant.md` qui bloque actuellement la batterie).

## Fix attendu

Selon root cause identifiée :
- Si state pas initialisé → ajouter `?? defaultValue` ou guard
- Si race condition debounce → cancellation token sur change filtre
- Si Zod parse qui throw → wrap dans try/catch + state d'erreur UI propre

Ajouter le scénario "rapid filter changes" comme spec E2E supplémentaire (5+ changements en 1 seconde) pour ne plus rater ce bug.

## Definition of done

- [ ] Root cause identifiée et documentée
- [ ] Fix appliqué + test unit Vitest ajouté
- [ ] Spec E2E correspondante repasse verte (la 3. preview se met à jour)
- [ ] Spec bonus : 5 changements rapides en 1 seconde → page rend toujours, pas de crash
- [ ] Test manuel staging : configurer + changer 10 fois divers filtres → aucun crash
- [ ] Push staging vert

## Estimation

~2-4h selon root cause.

## Référence

- Mega battery baseline 2026-05-25 17:11
- Spec qui fail : `e2e/staging-full/refill-icp.spec.ts:82:7`
- Screenshot : `test-results/refill-icp-Refill-ICP-page-7e145-r-quand-on-change-un-filtre-chromium-headfull/test-failed-1.png`
- Feature livrée par W7b session 2026-05-25 (commit `ffe0404`)
