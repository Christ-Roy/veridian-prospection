# [PROSPECTION] Husky check-sabotage-test — faux positif sur tests source-level

> **Type** : Hardening Husky / qualité tooling
> **Sévérité** : 🟢 P2 — faux positif récurrent qui ralentit les pushes agents
> **Owner** : agent Prospection
> **Créé** : 2026-05-24
> **Découvert par** : Agent I session 2026-05-23 (Task #9 renforcement 11 tests API)

## Symptôme

Le script `husky/check-sabotage-test.sh` détecte comme "sabotage VERT" certains tests source-level qui utilisent `source.match()` pour valider l'absence de patterns dangereux.

Cas connu : `__tests__/components/dashboard/settings-reference.test.tsx`. Le test fait du source-level (lit le fichier `.tsx`, fait `source.match(/dangerous-pattern/)`) — c'est intentionnel et correct pour ce type d'audit. Mais le script de sabotage ne le détecte pas comme tel et flag VERT.

## Pourquoi c'est gênant

- Pendant la Task #9 (Agent I), 1 test sur 11 était flag faux positif. Pas bloquant mais ralentit le diagnostic.
- Tant que ce faux positif n'est pas filtré, les agents qui touchent un test source-level vont s'arrêter pour creuser → perte de temps.
- Le script Husky devient moins crédible (cri au loup) si un dev s'habitue à voir des faux positifs et les ignore.

## Fix proposé

Faire détecter au script `check-sabotage-test.sh` les tests source-level (ceux qui font `fs.readFileSync()` + `source.match()` ou équivalent) et les exclure du sabotage muté.

Pattern de détection :
```bash
# Si le test contient `fs.readFileSync` ou `source.match` ou un import de `fs` côté test,
# c'est probablement un test source-level qui inspecte du code, pas du comportement runtime.
# Le sabotage muté de la source ne ferait pas rougir ces tests par construction.
```

Alternative : laisser les agents marker explicitement avec un commentaire `// sabotage-test:skip-source-level` en haut du fichier test.

## Effort

~1h. Diagnostic + filtre dans le script + 1 test du script lui-même (sabotage VERT volontaire → script doit dire "skipped: source-level test").

## Lien

- Découverte : rapport Agent I 2026-05-23 (Task #9)
- Script concerné : `husky/check-sabotage-test.sh` (ou équivalent dans `.husky/`)
- Memory : [[feedback_sabotage_test_audit]]
