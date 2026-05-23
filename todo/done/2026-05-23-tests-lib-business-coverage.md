# [PROSPECTION] Tests Vitest pour `src/lib/` — 35 fichiers sans test

> **Type** : Dette tests / robustesse hot paths
> **Sévérité** : 🔴 P0 — c'est là que vivent les bombes silencieuses (cf invitations.ts 2026-05-23, 5 jours en silence)
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Parent** : `todo/2026-05-23-app-robustness-cadre.md`

## Constat

35 fichiers dans `src/lib/` (32 + 7 queries hors composants UI) sont dans `tests-pending.txt` — la dette de tests assumée. **Aucun n'a de test Vitest.** Si l'un d'eux appelle un endpoint mort, on ne le verra qu'en prod.

## Liste exacte (extraite de tests-pending.txt 2026-05-23)

### `src/lib/auth/` (5 fichiers, **CRITIQUE** — entrée auth)
- `src/lib/auth.config.ts`
- `src/lib/auth.ts`
- `src/lib/auth/api-auth.ts`
- `src/lib/auth/middleware.ts`
- `src/lib/auth/roles.ts`
- `src/lib/auth/user-context.ts`

### `src/lib/queries/` (7 fichiers, **CRITIQUE** — accès DB hot path)
À lister par `grep "^src/lib/queries" tests-pending.txt`. Cible probable : pipeline, leads, prospects, lead-quota, lead-credits, plan-history, segments.

### `src/lib/` racine (autres helpers business)
- `src/lib/audit.ts`
- `src/lib/cache.ts`
- `src/lib/departments.ts`
- `src/lib/domains.ts`
- (+ ~20 autres, lister exhaustivement par `grep "^src/lib/[^/]*\.ts$" tests-pending.txt`)

## Ce qu'il faut faire

### Phase 1 — Inventaire et priorisation

1. `grep "^src/lib" tests-pending.txt` — liste exhaustive
2. Pour chaque fichier, classer par CRITICITÉ RUNTIME :
   - 🔴 **HOT PATH** : appelé à chaque request user (auth/api-auth, queries/pipeline, queries/leads, audit, cache) → P0
   - 🟡 **HOT PATH DÉCLENCHEUR** : appelé sur événement business (invitations, billing, hub/*, trial) → P0
   - 🟢 **UTILITAIRE** : helpers stables, pure functions (departments, domains, slug, format-utils) → P2 (mais test trivial = facile à écrire)
3. Trie en 3 lots P0 / P0 / P2.

### Phase 2 — Tests P0 d'abord

Pour chaque fichier P0 :
1. Lis le fichier en entier
2. Identifie les **comportements observables** (pas l'implémentation) :
   - Quel input → quel output ?
   - Quels effets de bord (DB, fetch, log) ?
   - Quels chemins d'erreur ?
3. Écris un test Vitest qui :
   - Mocke les dépendances I/O (Prisma, fetch, env)
   - Couvre le happy path + 2-3 cas d'erreur
   - **Sabotage-testé** : tu casses volontairement le code, le test DOIT rougir. Si tu peux casser sans déclencher de rouge, ton test est inutile, refais-le.
4. Retire la ligne correspondante de `tests-pending.txt`
5. Commit par batch logique (1 commit = 3-5 tests cohérents)

### Phase 3 — Tests P2 (utilitaires)

Pareil mais plus rapide. Tests triviaux = OK tant qu'ils détectent un sabotage évident. `departments.ts` qui parse un code postal → 1 test qui asserte le mapping + 1 test cas d'erreur.

### Phase 4 — Rapport

SendMessage team-lead :
- N tests écrits, N fichiers retirés de pending
- Sabotage-test confirmation (1 fichier au hasard, casser + test rouge + restaurer)
- SHA commits prêts à push

## Garde-fous

- ⛔ ZÉRO test bâclé. Robert a explicitement dit "NE BACLE PAS LES TESTS, il faut les tester et s'assurer qu'ils soient pertinents et ne cassent pas la CI pour rien et qu'ils durent". Un test fragile = pire qu'un test absent.
- ⛔ **PAS de mock qui valide rien** — l'incident invitations 2026-05-23 a survécu parce que le test mockait fetch Supabase, validant qu'un appel se faisait, sans valider que l'API cible existait. Tes mocks doivent capturer le CONTRAT, pas l'implémentation.
- ✅ Privilégie les tests d'intégration légère (vraie chaîne d'appel, mock uniquement les bordures système).

## Effort estimé

- Phase 1 (inventaire) : 30 min
- Phase 2 (P0, ~15 fichiers × 30 min) : 7-8h — un sprint à part entière
- Phase 3 (P2, ~20 fichiers × 10 min) : 3-4h
- Total : 1-2 jours dédiés

## Périmètre strict

Tu peux toucher : nouveaux fichiers `__tests__/lib/**/*.test.ts` OU tests colocalisés `src/lib/**/*.test.ts` selon la convention déjà en place dans le repo (cf `src/lib/invitations.test.ts` colocalisé). `tests-pending.txt` (retirer lignes). `test-coverage-map.yaml` si besoin déclaration non-canonique.

NE PAS TOUCHER : code source `src/lib/**/*.ts` (sauf typage qui empêche le test), composants UI, routes API, workflows CI.

## Workflow git

- Branche = `staging`
- ⛔ Zéro build local. Vitest unit local OK.
- Commit par batch (3-5 tests cohérents). Pas un mega commit.
- NE PAS PUSH — team-lead sérialise.
