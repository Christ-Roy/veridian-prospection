# [PROSPECTION] Husky — 3 nouveaux checks pour fermer les trous

> **Type** : Robustesse CI / garde-fous pre-push
> **Sévérité** : 🟡 P1 — sans ces 3 checks, le bug invitations 2026-05-23 (5j en silence) peut se reproduire
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Parent** : `todo/2026-05-23-app-robustness-cadre.md`

## Trous Husky identifiés (cf ticket cadre)

Les 7 checks actuels (test-mapping, route-safety, secrets, CVE, hygiène, env-sync, ui-build) **n'auraient pas attrapé le bug invitations 2026-05-23** :
- Le test mockait fetch Supabase → test vert sur API morte
- Le build passait → runtime indétectable au build
- Pas de smoke contractuel → l'endpoint `/auth/v1/admin/users` mort n'a pas été détecté

## 3 nouveaux checks à câbler

### 1. `scripts/ci/check-sabotage-test.sh` — détecte les tests qui ne FAIL pas

**Principe** : un test qui n'assert rien d'observable est inutile. Sabotage automatique léger sur les fichiers test modifiés dans le diff :
- Pour chaque `*.test.ts` modifié, identifie le fichier source associé (convention canonique OU coverage-map)
- Lance Vitest sur le test → doit être vert (sinon le test est déjà cassé, le hook n'est pas son rôle)
- **Sabotage** : commente la première ligne `return` ou remplace une valeur observable (ex : `return user.id` → `return null`) — temporaire, in-memory uniquement
- Re-lance Vitest → DOIT être rouge. Si toujours vert, le test ne teste rien → BLOCKING
- Restore le source intact

Skip d'urgence : `SKIP_SABOTAGE_TEST=1`.

**Limitation acceptée** : le sabotage est heuristique (sed/regex sur le source), pas une AST manipulation. Si le sabotage ne s'applique pas (pas de `return` à muter), skipper avec un warning, pas un block.

### 2. `scripts/ci/check-cross-app-contracts.sh` — smoke contractuel léger

**Principe** : pour chaque appel HTTP sortant vers un service Veridian, vérifier que l'URL cible existe et accepte le payload type documenté.

- Grep le code pour les patterns `fetch("${HUB_URL}/...")`, `fetch("${NOTIFUSE_URL}/...")`, `fetch("${CMS_URL}/...")`
- Pour chaque endpoint identifié :
  - Vérifie que l'URL répond (HEAD ou GET) — pas 404, pas DNS fail
  - Si POST/PUT avec payload documenté, fait un dry call (HEAD avec OPTIONS) pour valider que la méthode est acceptée
- BLOCKING si endpoint mort (404 / connection refused / DNS fail).
- Smoke léger uniquement — pas d'auth réelle, pas de side-effect.

Skip d'urgence : `SKIP_CROSS_APP_CONTRACTS=1`.

**Limitation acceptée** : ne couvre que les URLs en clair dans le code (pas les URLs construites dynamiquement). C'est mieux que rien — le bug invitations Supabase aurait été attrapé (URL `${SUPABASE_URL}/auth/v1/admin/users` en dur).

### 3. `scripts/ci/check-prisma-drift.sh` — schema vs DB réelle

**Principe** : `schema.prisma` doit être la vérité du schéma DB. Si la DB prod a des tables non déclarées, on a un drift silencieux (cf `results` + `segment_catalog` qui existent prod mais pas en schema, ticket P5 déjà déposé).

- Si le diff touche `prisma/schema.prisma` OU une migration → lance le check
- `npx prisma db pull --print --schema /tmp/pulled.prisma` contre une DB de référence (staging si configuré, sinon une DB locale)
- Compare `/tmp/pulled.prisma` vs `prisma/schema.prisma` (normalisation requise — l'ordre des modèles, des champs, etc.)
- Si différence → WARNING (pas bloquant la 1ère version, on observe l'usage avant de bloquer)

Skip : `SKIP_PRISMA_DRIFT=1`.

**Limitation acceptée** : nécessite une DB accessible. Si pas dispo en local, skipper avec un warning explicite.

## Pattern de chaque script

Hérité de l'existant `scripts/ci/check-ui-build.sh` :
- En-tête doc qui explique POURQUOI le script existe (avec ref à l'incident qui l'a motivé : invitations 2026-05-23, drift Prisma 2026-05-21)
- Exit code propre (pas pipe qui masque)
- Couleurs ANSI cohérentes
- Skip d'urgence via env var
- Fail-safe : si dépendance manquante, bloque (sauf cas explicite warning)

## Branchement `.husky/pre-push`

Ajouter 3 sections numérotées après `1septies` :
- `1octies` → sabotage-test
- `1nonies` → cross-app contracts
- `1decies` → prisma drift

Avec les mêmes garde-fous que `1septies` :
```sh
if [ -x scripts/ci/check-sabotage-test.sh ]; then
  scripts/ci/check-sabotage-test.sh
fi
```

## Tests des nouveaux checks (sabotage du sabotage)

Pour chaque nouveau script :
- Cas SAIN → exit 0
- Cas DÉTECTÉ → exit ≠ 0 + message clair identifie quoi rouge
- Cas dépendance manquante → comportement attendu (skip warning OU block selon le check)

## Effort

- check-sabotage-test : ~3h (heuristique, edge cases)
- check-cross-app-contracts : ~2h (grep + curl simple)
- check-prisma-drift : ~2h (db pull + normalisation diff)
- Branchement + tests + doc : ~1h
- **Total : ~1 jour**

## Périmètre strict

Tu peux toucher : `scripts/ci/` (3 nouveaux fichiers), `.husky/pre-push` (ajout 3 sections), nouveaux tickets dans `todo/` si tu découvres autre chose. NE PAS TOUCHER : `src/`, composants UI, workflows CI (sauf si tu veux mirror un check côté CI).

## Workflow git

- Branche = `staging`
- ⛔ Zéro build local
- Tester les scripts localement OK (ils sont conçus pour tourner local)
- NE PAS PUSH — team-lead sérialise. **Surtout, le branchement `.husky/pre-push` est tier 🔴 HAUT** (s'applique à tous les push de l'équipe), je veux valider en dernier.
