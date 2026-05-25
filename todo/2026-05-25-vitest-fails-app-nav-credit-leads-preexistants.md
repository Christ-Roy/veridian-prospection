# [PROSPECTION] Vitest fails préexistants — app-nav badge trial + credit-leads leadOrder

> **Type** : Bug régression tests (préexistant Vague 9)
> **Sévérité** : 🟢 P2 — tests fails mais pas bloquants CI staging (les fichiers concernés ne sont pas dans la coverage map déclarée du push qui passe), à investiguer pour la santé du test runner global
> **Owner** : agent Prospection à spawner
> **Créé** : 2026-05-25 par team-lead pendant Vague 9
> **Découvert par** : W9c qui a noté 2 fails Vitest préexistants avant ses propres changements

## Symptôme

Quand on lance `npx vitest run` sans cibler de fichier, **2 tests fails** :

1. `src/__tests__/components/app-nav-badge-trial.test.tsx` (ou nom approchant — chercher `app-nav` ou `badge` ou `trial`)
2. `src/__tests__/lib/credit-leads-leadOrder.test.ts` (ou nom approchant)

W9c a confirmé que **ces fails existent AVANT** ses changements de la Vague 9 (W9c a fait un baseline run sur staging actuel pour vérifier). Ils ne sont donc pas introduits par les chantiers F/A/I/J.

## Pourquoi ils ne bloquent pas la CI

La CI Prospection utilise le système `check-test-mapping.sh` qui ne valide que les **tests référencés dans `test-coverage-map.yaml`**. Les 2 fichiers fails sont soit :
- Pas dans la coverage map (donc ignorés)
- Dans la coverage map mais avec un mapping flou qui passe

→ La CI peut être verte avec des tests qui échouent localement. C'est un trou.

## Investigation à mener

1. **Identifier les 2 fichiers exacts** :
```bash
cd /home/brunon5/Bureau/veridian-platform/veridian-prospection
npx vitest run --reporter=verbose 2>&1 | grep -E "FAIL|✗" | head -20
```

2. **Diagnostiquer chaque fail** : stack trace, dernière modif des fichiers concernés (`git log -1 <fichier>`), corrélation avec un commit récent de la session 2026-05-25.

3. **Hypothèses possibles** :
   - **app-nav badge trial** : probablement lié au `TrialBanner` qui a aussi le bug React #418 — peut-être le même root cause hydration (cf ticket sibling `2026-05-25-hydration-mismatch-react-418-trial-banner.md`)
   - **credit-leads leadOrder** : probablement régression introduite par W7b (`feat(refill-icp): page native /leads/buy + checkout via Hub HMAC v2.1`) qui a étendu `credit-leads` avec contract_version 2.1 + filters_json. Le test attendait peut-être une signature v2.0.

4. **Fixes possibles** :
   - Mettre à jour les tests pour matcher le code actuel (si tests obsolètes)
   - OU mettre à jour le code si les tests révèlent un vrai bug
   - Ajouter les fichiers à `test-coverage-map.yaml` pour que la CI les enforce à l'avenir

## Périmètre

- Identifier les 2 fichiers
- Diagnostiquer
- Fix selon le diagnostic
- Tests 100% verts en lancement global `npx vitest run`
- Ajout dans `test-coverage-map.yaml` si manquant

## Definition of done

- [ ] `npx vitest run` (sans cibler) → 0 fail
- [ ] Les 2 fichiers ajoutés à `test-coverage-map.yaml` si non présents
- [ ] Push staging vert
- [ ] Commit `[risk:low]` ou `[risk:medium]` selon scope du fix

## Estimation

~1-2h (identifier + fix selon trivialité).

## Référence

- Session Vague 9 — W9c a signalé les 2 fails dans son message de livraison avant push
- Peut être lié au ticket sibling React #418 hydration TrialBanner (`2026-05-25-hydration-mismatch-react-418-trial-banner.md`)
