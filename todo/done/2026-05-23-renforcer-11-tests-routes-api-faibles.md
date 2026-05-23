# [PROSPECTION] Renforcer 11 tests routes API faibles (sabotage VERT)

> **Type** : Dette tests
> **Sévérité** : 🟡 P1 — découvert par check-sabotage-test 2026-05-23. Ces tests sont historiquement faibles (le pattern du bug invitations 2026-05-23).
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Détection** : check-sabotage-test au push staging `b8b33e9`
> **Statut** : ✅ LIVRÉ 2026-05-23 (Agent I — vague 3)

## Livraison

Le travail s'est fait en 4 vagues de commits, tous `[risk:low]` :

- `0dc6378` — renforce checkout / leads / stats-today (assert body retourné)
- `cf421ac` — renforce prospects / segments / summarize-call
- `0f2ab51` — renforce phone/call-log / presence / server-call / telnyx-token
- `172f5d5` — durcit prospects / server-call sur les lignes sabotage restantes
- vague 3 (Agent I 2026-05-23) — ajoute 3 tests `sortDir` à `leads.test.ts`
  pour faire rougir le sabotage `===` → `!==` (L16 route.ts).

Vérif finale : `BASE_REF=ef61e7e^ scripts/ci/check-sabotage-test.sh` ne
reporte plus qu'un seul fail résiduel sur `settings-reference.test.tsx`
(test source-level qui n'est pas un faux positif côté ticket — hors
périmètre, à traiter via un autre cycle si besoin).

## Constat

11 tests routes API restent VERT après sabotage (`return null` ou `===` → `!==` sur la 1ère fonction du source). Cela signifie qu'ils valident des MOCKS sans asserter sur le COMPORTEMENT réel — exactement le pattern qui a laissé passer le bug invitations Supabase pendant 5 jours.

## Liste exacte (11 routes)

```
src/app/api/checkout/route.ts             ← __tests__/api/checkout.test.ts
src/app/api/leads/route.ts                ← __tests__/api/leads.test.ts
src/app/api/phone/call-log/route.ts       ← __tests__/api/phone/call-log.test.ts
src/app/api/phone/presence/route.ts       ← __tests__/api/phone/presence.test.ts
src/app/api/phone/server-call/route.ts    ← __tests__/api/phone/server-call.test.ts
src/app/api/phone/summarize-call/route.ts ← __tests__/api/phone/summarize-call.test.ts
src/app/api/phone/telnyx-token/route.ts   ← __tests__/api/phone/telnyx-token.test.ts
src/app/api/prospects/route.ts            ← __tests__/api/prospects.test.ts
src/app/api/segments/[...slug]/route.ts   ← __tests__/api/segments/[...slug].test.ts
src/app/api/stats/today/route.ts          ← __tests__/api/stats/today.test.ts
+ 1 autre (à grep dans la sortie sabotage)
```

## Pourquoi maintenant

Ces 11 routes ont été TOUCHÉES par le commit `69ba7fa` (rename `@/lib/supabase/tenant` → `@/lib/auth/tenant`). Le check-sabotage-test boucle sur les fichiers modifiés et a donc sabotage-testé leurs tests, qui sont passés vert → faux positif pour CE push (c'est un rename safe), mais vrai signal long terme : ces tests sont effectivement faibles.

## Fix attendu pour chaque test

Pattern actuel typique (à confirmer en lisant chaque test) :
```ts
// FAIBLE : mock prisma, assert qu'on a appelé prisma, sans asserter sur la VALEUR retournée
vi.mock("@/lib/prisma", () => ({ prisma: { foo: vi.fn().mockResolvedValue([]) } }));
expect(mockPrisma.foo).toHaveBeenCalled();  // ne casse PAS si la route retourne le mauvais shape
```

Pattern fort attendu :
```ts
// FORT : mock prisma, assert sur la VALEUR RETOURNÉE par la route
const response = await GET(makeRequest("/api/checkout"));
expect(response.status).toBe(200);
const body = await response.json();
expect(body).toEqual({ ...shape attendu... });  // casse si la route renvoie autre chose
```

Sabotage-test attendu : si tu remplaces `return NextResponse.json({success:true})` par `return null`, le test DOIT échouer (parce qu'il assert sur `body.success`).

## Effort

- ~30 min par test × 11 = 5-6h
- Sprint dédié, pas urgent (les routes fonctionnent en prod, c'est juste le TEST qui est faible)

## Référence

- Pattern exemple correct : `__tests__/api/invitations/[token]/accept.test.ts` (commit `22f6c34`) — assert sur `body` retourné, sabotage-testable
- Pattern à fuir : tests qui mockent fetch externe et n'assertent que sur l'appel (bug invitations 2026-05-23)
- Memory `feedback_sabotage_test_audit`

## Garde-fou pour le futur

Le check `check-sabotage-test.sh` détecte automatiquement ces patterns au pre-push. Tant que cette dette n'est pas résorbée, un push qui modifie une de ces 11 routes va être bloqué. C'est volontaire.

## Workaround temporaire

Pour push staging du 2026-05-23 : `SKIP_SABOTAGE_TEST=1` justifié (le rename `@/lib/supabase/tenant → @/lib/auth/tenant` est cosmétique, ne touche pas la logique des routes, le sabotage est un faux positif sur du code legacy). Documenté dans le commit du push.

Pour les push futurs touchant CES routes : exiger le renforcement du test correspondant.
