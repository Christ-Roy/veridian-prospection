# Route safety audit — 6 routes sans try/catch ni Zod sur request.json()

> **Type** : Hygiène sécu/robustesse (OWASP A04 input validation)
> **Sévérité** : 🟡 P2 (500 silencieux mais pas de leak data)
> **Owner** : agent Prospection
> **Créé** : 2026-05-21

## Contexte

Le script `scripts/ci/check-route-safety.sh` (livré 2026-05-21 dans husky pre-push, mode **soft warning**) détecte les `route.ts` qui appellent `await request.json()` sans try/catch ni Zod `safeParse`. Symptôme : un client qui envoie un JSON malformé déclenche un 500 silencieux (le `.json()` throw → propagation jusqu'au framework Next.js → réponse 500 sans message structuré).

## Routes en dette

| # | Fichier | Plan de fix |
|---|---|---|
| 1 | `src/app/api/outreach/[domain]/route.ts` | wrap `request.json()` dans try/catch → `{ error: "invalid_payload" }, status: 400` |
| 2 | `src/app/api/admin/workspaces/[id]/route.ts` | idem |
| 3 | `src/app/api/admin/workspaces/route.ts` | idem |
| 4 | `src/app/api/admin/members/route.ts` | idem |
| 5 | `src/app/api/admin/members/[userId]/route.ts` | idem |
| 6 | `src/app/api/admin/invites/route.ts` | idem |

## Pattern de fix standard

```ts
let body: unknown;
try {
  body = await request.json();
} catch {
  return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
}
```

Si la route a des champs requis avec validation type/format précise → préférer **Zod** (cf `src/app/api/users/by-email/route.ts` et `src/app/api/workspaces.generateMagicLink/route.ts` pour des patterns inline sans schema dédié, ou créer un schema Zod dédié si > 3 champs).

## Plan d'exécution

1. **Sprint A** (~1h) : fix les 6 routes une par une, ajouter test 400 dans chaque test file existant correspondant.
2. **Flip blocking** : une fois 0 violation `bash scripts/ci/check-route-safety.sh`, retirer `ROUTE_SAFETY_SOFT=1` du hook `.husky/pre-push` (commit `chore(husky): route safety check blocking [risk:low]`).

## Pourquoi pas tout de suite

Audit livré pendant la session Phase 3 generateMagicLink — éviter d'empiler la dette avec les nouveaux endpoints. Fix dans une session dédiée pour ne pas mélanger les scopes.

## Définition of Done

- [ ] 6 routes patchées avec try/catch ou Zod
- [ ] 6 tests 400 invalid_payload ajoutés
- [ ] `bash scripts/ci/check-route-safety.sh` retourne 0 violation
- [ ] `.husky/pre-push` flip blocking (retire `ROUTE_SAFETY_SOFT=1`)
- [ ] Ticket archivé en `todo/done/`
