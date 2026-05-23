# [PROSPECTION] Flaky E2E workers=4 — concurrence compte canonique partagé

> **Type** : Dette tests / flakiness E2E
> **Sévérité** : 🟢 P2 — pas bloquant (specs en `extended/` non-bloquant), mais bruit dans la CI
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-skip-vide (Phase validation E2E workers=4)

## Symptôme

En mode workers=4 (CI staging mode), 2 specs deviennent flaky alors qu'elles sont vertes en workers=1 :
- `e2e/extended/lead-detail-interactions.spec.ts` (test "open lead sheet")
- `e2e/extended/search-prospects.spec.ts` (test "search input")

## Causes identifiées

1. **Pollution Command Palette aria** : la `CommandPalette` (Cmd+K) garde des handlers globaux entre tests qui se télescopent quand 4 instances tournent en parallèle sur le même compte
2. **Concurrence compte canonique** : tous les workers utilisent le compte `e2e-persistent` + Outreach SIREN `900000001` seedé par `ensureCanonicalUser()`. Quand 4 workers mutent l'état de cet outreach en parallèle, race condition

## Fix possibles

### Option A — workers=1 sur ces 2 specs uniquement
```ts
test.describe.configure({ mode: 'serial' });
// ou
test.describe.configure({ retries: 3 });
```

### Option B — compte canonique par worker
Modifier `ensureCanonicalUser()` pour suffixer l'email/SIREN avec `process.env.TEST_PARALLEL_INDEX` :
- `e2e-persistent-${idx}@yopmail.com`
- SIREN `90000000{idx}`
N suffixes pour N workers, isolation garantie. Coût : seed N comptes au lieu de 1.

### Option C — fix le bug Command Palette (vraie cause racine)
Si les handlers globaux ne sont pas idempotents, les nettoyer proprement au unmount. Investigation : `src/components/command-palette.tsx`.

## Reco agent

Option A en quick fix temporaire (10 min, met le sprint en pause sur ces 2 specs flaky). Option B en sprint dédié (~2h). Option C en investigation si la flakiness persiste après B.

## Référence

- Découverte : agent e2e-skip-vide 2026-05-23 (validation E2E post-fix skip silencieux)
- Helper canonique étendu : commit `cfbc9d4`
- 2 specs concernées : `e2e/extended/lead-detail-interactions.spec.ts`, `e2e/extended/search-prospects.spec.ts`
