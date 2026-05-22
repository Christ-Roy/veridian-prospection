# [PROSPECTION] Refill leads (2/3) — welcome leads à la souscription

> **Type** : Feature billing — grant initial de leads
> **Sévérité** : 🟡 P1 — sans ça un nouveau client a 0 lead exploitable
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Réfère** :
>   - `veridian-hub/docs/PRICING-VERIDIAN.md` §78 (welcome leads par plan)
>   - `todo/2026-05-22-refill-1-endpoint-credit-leads.md` (préreq)
> **Dépend de** : ticket refill 1/3 (l'endpoint `credit-leads` + le quota)

## Contexte

`PRICING-VERIDIAN.md` §78 définit les **welcome leads** — une quantité de
leads offerte one-shot à la souscription, proportionnelle au plan :

| Plan | Welcome leads (one-shot à la souscription) |
|---|---|
| Free / Freemium | 100 |
| Pro | 2 000 |
| Business | 8 000 |

(Valeurs à reconfirmer contre la dernière version de `PRICING-VERIDIAN.md`
au moment de coder — la grille évolue.)

Aujourd'hui : non câblé. Un nouveau tenant provisionné a `leadsCredited=0`
→ il ne peut rien faire. C'est un trou business identifié dans
`veridian-hub/todo/2026-05-21-audit-cross-app-state.md` ("welcome leads
grant non câblé").

## Demande

Au moment où un tenant est **provisionné** ou **change de plan**, créditer
automatiquement les welcome leads correspondants — UNE seule fois par
palier de plan atteint.

### Question d'architecture à trancher

Qui décide du grant welcome leads ? Deux options :
- **A — le Hub** envoie un `credit-leads` avec `source: "welcome"` lors
  du provisioning / de l'upgrade (réutilise l'endpoint du ticket 1/3).
  Cohérent : le Hub orchestre déjà le billing. **Recommandé.**
- **B — Prospection** crédite elle-même les welcome leads dans son
  handler `provision` / `update-plan` en lisant la grille du
  `shared/` submodule.

→ Si option A : ce ticket = surtout coordination avec l'agent Hub +
s'assurer que `credit-leads source=welcome` est idempotent par palier.
→ Si option B : ce ticket = logique locale dans `provision` +
`update-plan`, en lisant les quantités depuis `@veridian/shared` (le
submodule porte déjà les constantes pricing cross-app).

**Recommandation** : option A — garder le Hub seul maître du billing,
cohérent avec `CONTRAT-BILLING.md`. Mais à confirmer avec l'agent Hub.

## Invariant critique — pas de double grant

Le welcome leads est offert **une fois par palier**, pas à chaque
`update-plan`. Exemples :
- Provision en Free → +100. Upgrade Free→Pro → +1 900 (le delta vers le
  palier Pro), PAS +2 000.
- OU : +2 000 à l'upgrade Pro et on ne re-crédite jamais le Free. À
  trancher — le plus simple : créditer le **delta** entre paliers.
- Un downgrade ne retire jamais de leads (ils sont permanents, cf
  `PRICING-VERIDIAN.md` §97).
- Un `update-plan` rejoué (idempotency) ne re-grant pas.

À spécifier précisément dans l'implémentation et à tester.

## Tests obligatoires

- Provision Free → solde = 100.
- Upgrade Free→Pro → solde reflète le palier Pro, pas de double compte.
- `update-plan` rejoué → pas de re-grant.
- Downgrade → leads conservés.

## Definition of Done

- [ ] Architecture grant (option A Hub / B local) tranchée avec l'agent Hub
- [ ] Welcome leads crédités au provisioning + à l'upgrade
- [ ] Anti-double-grant par palier vérifié
- [ ] Quantités lues depuis `@veridian/shared` (source unique cross-app)
- [ ] Tests verts
- [ ] Réponse + archivage done/
