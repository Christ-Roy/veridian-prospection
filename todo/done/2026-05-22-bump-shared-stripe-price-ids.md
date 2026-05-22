# [PROSPECTION] Bump du submodule shared — Price IDs Stripe provisionnés

> **Sévérité** : 🟢 P2 — non bloquant, resync de cohérence
> **Owner** : agent Prospection
> **Créé** : 2026-05-22 (déposé par l'agent Hub, sprint billing Stripe)
> **Réfère** : `veridian-infra/shared/pricing/plans.ts`, `docs/CONTRAT-BILLING.md` v2.0

---

## Contexte

Le sprint billing Stripe côté Hub a provisionné les Products + Prices
Stripe (6 Products, 12 Prices — month + year). Le catalogue canonique
`veridian-infra/shared/pricing/plans.ts` a été mis à jour : les 6 plans
payants ont désormais `stripePriceIdLive` et `stripePriceIdTest` remplis
(commit `8dc127a` sur `veridian-infra/main`).

## Ce qu'il faut faire (quand pratique)

Bumper le pointeur de submodule `shared` côté Prospection pour pointer
sur le SHA `8dc127a` (ou plus récent) :

```bash
cd veridian-prospection
git submodule update --remote shared
git add shared
git commit -m "chore(shared): bump catalogue → Price IDs Stripe provisionnés"
```

## Est-ce urgent ?

Non. Prospection consomme le submodule `shared` pour les **constantes
business** (grille de prix affichée, features, refill leads). Elle
n'utilise PAS les `stripePriceId*` : conformément à `CONTRAT-BILLING.md`
§2.3, une app commerciale n'appelle jamais l'API Stripe — le Hub est seul
interlocuteur Stripe et crée les checkout sessions. Les Price IDs ne
servent qu'au Hub.

Le bump n'apporte donc à Prospection que les Price IDs (champs non
consommés) — c'est un resync de cohérence, pas un fix fonctionnel. À
faire au prochain `git submodule update --remote shared` de routine, ou
si tu veux que `shared` reflète l'état exact en prod.

Aucune régression si non fait : Prospection garde sa copie figée du
catalogue, prix et features inchangés.
