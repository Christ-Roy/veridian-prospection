# [PROSPECTION] URLs par défaut `saas-prospection.staging.veridian.site` mortes dans 18 specs E2E

> **Sévérité** : 🟡 P1 — dette de cohérence E2E. Pas bloquant en CI (overridable par `PROSPECTION_URL`), mais piège quiconque lance les specs en local sans env var.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-17-specs (en migrant les 17 specs Supabase)

## Le problème

L'host `saas-prospection.staging.veridian.site` est mort depuis la
migration polyrepo de 2026-05-13 — l'host actuel est
`prospection.staging.veridian.site`.

**18 specs** ont encore la vieille URL en valeur par défaut de
`PROSPECTION_URL` :

```
e2e/admin-pages-v1.spec.ts
e2e/browser-flow.spec.ts (deprecated — peut être skip)
e2e/client-error-boundary.spec.ts
e2e/core/status-endpoint.spec.ts
e2e/filters-persistence.spec.ts
e2e/historique-page.spec.ts
e2e/keyboard-shortcuts-help.spec.ts
e2e/lead-detail-interactions.spec.ts
e2e/search-prospects.spec.ts
e2e/segments-filter.spec.ts
e2e/settings-page.spec.ts
e2e/status-endpoint.spec.ts
e2e/ui-siren-smoke.spec.ts (note seulement, déjà migré)
e2e/extended/admin-pages-v1.spec.ts
e2e/extended/appointments-full-flow.spec.ts
e2e/extended/client-error-boundary.spec.ts
e2e/extended/keyboard-shortcuts-help.spec.ts
e2e/extended/lead-detail-interactions.spec.ts
e2e/extended/search-prospects.spec.ts
e2e/extended/segments-filter.spec.ts
e2e/extended/settings-page.spec.ts
```

Le ticket original `2026-05-22-e2e-specs-auth-supabase-inline.md` mentionnait
ce point en "Bonus" mais ne l'a pas couvert.

## Pourquoi c'est gênant

1. **En CI** : `PROSPECTION_URL` est posé par le workflow, donc le défaut
   est ignoré → CI verte. Mais le code "marche par accident".
2. **En local** : un dev qui lance `npx playwright test e2e/extended/...`
   sans `PROSPECTION_URL` exporté tape l'host mort → timeout DNS ou 404
   confus. Difficile à diagnostiquer pour quelqu'un qui découvre la stack.
3. **Audit / découverte** : `grep saas-prospection` dans le repo doit
   être vide post-polyrepo. C'est un marqueur de dette claire.

## Fix proposé

Rechercher / remplacer dans `e2e/**/*.spec.ts` :

```bash
sed -i 's|saas-prospection.staging.veridian.site|prospection.staging.veridian.site|g' \
  e2e/**/*.spec.ts
```

Vérifier qu'aucun autre host obsolète ne traîne :

```bash
grep -rn "saas-prospection\|saas-api\|saas-hub" e2e/
# Doit être vide après fix (sauf commentaires explicatifs dans
# specs migrées Supabase qui les mentionnent comme historique).
```

## Validation post-fix

```bash
# Sur dev-pub, container Playwright avec PROSPECTION_URL non posé :
ssh dev-pub 'docker run --rm --network staging-edge \
  -v /tmp/e2e-urls:/work -w /work \
  -e DATABASE_URL="postgresql://app:.../prospection?connection_limit=10" \
  -e CI="1" \
  mcr.microsoft.com/playwright:v1.60.0-jammy \
  bash -c "npm ci --silent && npx playwright test e2e/extended/search-prospects.spec.ts --project=chromium --reporter=list"'
```

Les specs doivent pointer sur `prospection.staging.veridian.site` par
défaut et passer.

## Périmètre

Strictement les 21 fichiers `.spec.ts` listés. **Ne pas toucher** au
code `src/`, aux helpers, ni au workflow CI.

## Effort

~30 min — recherche/remplacement + grep de vérif + run smoke sur 2-3
specs au hasard pour valider.
