# [PROSPECTION] Mail rate limit — divergence doc/code à trancher

> **Type** : Doc / arbitrage produit
> **Sévérité** : 🔵 P3 — pas un bug, juste une décision à figer
> **Owner** : agent Prospection / Robert
> **Créé** : 2026-05-25
> **Demandeur** : Agent V (vague 6, batteries tests E2E mail)

## Contexte

Le ticket d'origine `todo/2026-05-25-mail-batteries-tests-e2e.md` (et la
spec posée par Robert au team-lead pour Agent V) mentionne :

> `mail-rate-limit.spec.ts` : 11 envois en <60s → le 11e retourne 429

Or le code actuel (`src/app/api/mail/send/route.ts:71`) est :

```ts
if (isRateLimited(`mail-send:${auth.user.id}`, 30, 300_000)) {
  return NextResponse.json({ error: "Rate limited" }, { status: 429 });
}
```

→ **30 envois / 5min sliding window**, pas 10/min.

La spec E2E `05-mail-rate-limit.spec.ts` que j'ai posée asserte le
comportement RÉEL (30/5min), pas le comportement supposé (10/min).

## Question pour Robert

Quel est le bon seuil pour la mail v1 ? Le code reflète une décision plus
récente que la spec écrite. Trois options :

- **A) On garde 30/5min (statu quo code)** → la spec E2E est correcte,
  je raccroche le commentaire du ticket de batteries en
  "asserte le comportement réel". Rien à faire d'autre.
- **B) On revient à 10/min** (durcir la prod, perception : "le user
  ne devrait pas avoir besoin d'envoyer 30 mails par 5min depuis
  Veridian Prospection v1") → modif src + spec asserte 10/min.
- **C) On fait 30/5min ET 10/min en burst** (double bucket) → over-engineering
  v1, à reporter v2.

## Mon avis

**A** par défaut. 30/5min = ~6 envois/min en moyenne, suffisamment
généreux pour un workflow "j'envoie un mail par lead pendant 5min" sans
gêner, mais cap à 30 dans un burst.

Le seul cas où **B** serait justifié : si la prod commence à voir des
abus (bug UI loop). Auquel cas on durcit après détection.

## Lien

- Code : `src/app/api/mail/send/route.ts:71`
- Test : `e2e/flows-mail/05-mail-rate-limit.spec.ts`
- Ticket parent : `todo/done/2026-05-25-mail-batteries-tests-e2e.md`
