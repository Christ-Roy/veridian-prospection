# [PROSPECTION] Hydration mismatch React #418 — bandeau trial AppNav

> **Sévérité** : 🟢 P2 — visuel intermittent, pas bloquant fonctionnellement.
> **Owner** : agent Prospection (hors E2E)
> **Créé** : 2026-05-25
> **Découvert par** : agent W9b (vague 9, fix E2E flaky)

## Symptôme

Sur staging, `pageerror` React `Minified React error #418` ("Text content
does not match server-rendered HTML") capturé de façon intermittente
pendant le chargement de `/admin/invitations` (et sans doute d'autres
pages — pas re-testé exhaustivement).

Snapshot du contexte au moment de l'erreur : composant `Essai gratuit —
4j` rendu dans le header (TrialProvider + AppNav, voir `src/components/layout/`).

## Cause probable

Hydration mismatch sur la durée d'essai restante. Le SSR calcule
`Math.ceil((trialEndDate - now) / day)` côté serveur, le client refait
le calcul à l'hydration. Si les deux tombent sur une seconde différente
qui change le résultat de l'arrondi (ex : transition de "5j" → "4j" à
minuit pile), React détecte un mismatch et throw #418.

Autres pistes :
- Date locale vs UTC entre serveur et client
- Fuseau horaire conteneur vs browser
- Locale française du formatter dans une lib qui n'est pas SSR-safe

## Reproduction

1. Login admin staging
2. Goto `/admin/invitations` (ou n'importe quelle page avec TrialProvider)
3. Observe la console — environ 1 fois sur 5 sur staging sous pression

## Impact

- E2E `invite-flow.spec.ts` flakait à cause de cette erreur (fixé par
  W9b 2026-05-25 en ignorant `#418` dans le listener de spec — voir
  `e2e/extended/invite-flow.spec.ts` `attachErrorListeners`)
- Visuel : flash visuel du composant trial (re-render React après mismatch)

## Fix suggéré

Stabiliser le calcul de la date côté SSR :

```tsx
// src/components/layout/trial-banner.tsx (ou équivalent)
// Au lieu de calculer la durée à l'hydration, la passer figée depuis le SSR.
'use client'
export function TrialBanner({ daysRemaining }: { daysRemaining: number }) {
  return <span>Essai gratuit — {daysRemaining}j</span>
}

// côté server component parent :
const daysRemaining = Math.ceil((trialEndDate.getTime() - Date.now()) / 86400000)
return <TrialBanner daysRemaining={daysRemaining} />
```

Le client n'a plus rien à recalculer → pas de mismatch possible.

## Effort

- Investigation précise du composant fautif : 30 min
- Fix : 30 min
- Validation visuelle staging : 15 min

## Référence

- W9b session 2026-05-25 — fix E2E flaky invite-flow + mobile-viewport
- Filtre `#418` posé dans `e2e/extended/invite-flow.spec.ts` ligne 49+
- Quand le hydration mismatch est résolu côté UI, retirer le filtre
