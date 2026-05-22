# [PROSPECTION] Aligner le consumer `update-plan` sur CONTRAT-BILLING v2

> **Type** : Mise en conformité contractuelle billing cross-app
> **Sévérité** : 🟡 P1
> **Owner** : agent Prospection
> **Créé** : 2026-05-22 par l'agent Hub
> **Réfère** : `veridian-hub/docs/CONTRAT-BILLING.md` **v2.0 — RÉDIGÉ**
>   (rédigé 2026-05-22 sur la branche `staging` de `veridian-hub`)
> **Statut** : 🟢 DÉBLOCABLE — le contrat existe. Attendre toutefois sa
>   promotion sur `veridian-hub` main avant d'archiver ce ticket.

---

## ✅ TIMING — le contrat est rédigé

`CONTRAT-BILLING.md` v2.0 a été **rédigé** (2026-05-22). Tu peux attaquer
l'audit et les corrections.

Lis en priorité, AVANT de toucher à ton code :
`veridian-hub/docs/CONTRAT-BILLING.md` — en entier. Sections critiques
pour ce ticket :
- **§3** — payload `update-plan` v2 (schéma, `contract_version`, les 4
  `plan_source`, invariants §3.4).
- **§3.2bis** — **mapping `free` ↔ `freemium` TRANCHÉ** (voir ci-dessous,
  section "Mapping").
- **§4** — fail-open.
- **§7** — articulation trial.
- **§8.4** — **refill leads TRANCHÉ** (voir ci-dessous, section "Refill").

> Le contrat est sur la branche `staging` de `veridian-hub` au moment où
> ce ticket est mis à jour. Vérifie qu'il est promu sur `main` avant
> d'archiver ce ticket en `done/`.

---

## Contexte

Le Hub découpe son contrat monolithique. La partie billing devient
`CONTRAT-BILLING.md`, scopé aux **apps commerciales** : Notifuse +
Prospection. Prospection est concerné à plein titre (app SaaS payante avec
plans Freemium/Pro/Business + refill leads).

## Écarts probables à auditer (avant le contrat figé)

Lis ton handler `update-plan` actuel (`src/app/api/tenants/update-plan/` ou
équivalent) et vérifie :

1. **Versioning** — lit-il `contract_version` ? Le v2 exige rejet 400 si
   major inconnu.
2. **Enum `plan` fermé** — valide-t-il `plan` ∈ {free, pro, business,
   enterprise} ? Mapping `free`↔`freemium` : **TRANCHÉ dans le contrat
   v2 §3.2bis** (voir section "Mapping" plus bas).
3. **`plan_source` enum** — `stripe | stripe_trial | grant_manual |
   downgrade_auto`. Distinguer `stripe_trial` de `stripe`.
4. **Idempotence** — dédoublonnage sur `idempotency_key`.
5. **Plan offert immune** — tenant `plan_source=grant_manual` (lifetime,
   internal) pas downgradé par un `update-plan plan_source=stripe`.
6. **Fail-open** — INTERDIT : cron Prospection qui downgrade par timeout
   Hub-down. Dernier état connu en cas de doute.

## Mapping `free` ↔ `freemium` — TRANCHÉ (contrat v2 §3.2bis)

Le contrat v2 a tranché : **l'enum `plan` du payload est canonique
cross-app** (`free | pro | business | enterprise`). Le Hub envoie toujours
**`free`** sur le fil, jamais `freemium`. Prospection fait le mapping
`free → freemium` **côté elle** (adaptateur d'affichage local). Ton handler
`update-plan` valide l'enum **canonique** ; `freemium` ne franchit jamais
l'API. Détail : `CONTRAT-BILLING.md` §3.2bis.

Cas `enterprise` : Prospection n'a pas de tier Enterprise. Si le Hub envoie
`update-plan plan=enterprise`, **ne pas renvoyer 400** (l'enum est valide) —
traiter comme `business` (ton plan le plus élevé) + log warn. Documenté
§3.2bis.

## Refill leads — TRANCHÉ (contrat v2 §8.4)

Le contrat v2 a tranché : le **refill leads N'EST PAS du `update-plan`**.

- **Flux 1 — abonnement SaaS** (Freemium/Pro/Business) : `update-plan`
  reçu du Hub. C'est l'objet de ce ticket.
- **Flux 2 — achat de leads one-shot** (refill dégressif) : flux séparé.
  **Le Hub reste seul interlocuteur Stripe** (y compris pour le Checkout
  one-shot des leads). Prospection NE crée PAS la session Checkout, NE
  reçoit PAS le webhook Stripe. Le Hub propage un **signal de crédit
  dédié** (endpoint `credit-leads` ou équivalent — pas encore figé,
  ticket séparé). Détail : `CONTRAT-BILLING.md` §8.4.

Ce flux 2 recoupe les trous business déjà identifiés dans
`veridian-hub/todo/2026-05-21-audit-cross-app-state.md` (route
`/api/refill-leads` absente, welcome leads grant non câblé). **Ces 2 trous
méritent leurs propres tickets Prospection.** Ce ticket-ci ne couvre QUE
le consumer `update-plan` de l'abonnement SaaS.

## Ce que ce ticket NE demande PAS

- Pas de webhook Stripe direct côté Prospection (gravé interdit dans v2 §2)
- Pas de gestion du dunning
- Pas le refill leads (ticket séparé)

## Definition of Done

- [ ] `CONTRAT-BILLING.md` v2.0 lu en entier (✅ rédigé — voir lien en tête)
- [ ] Handler `update-plan` audité contre les 6 écarts
- [ ] Mapping `free`→`freemium` implémenté côté adaptateur local (§3.2bis)
- [ ] Cas `plan=enterprise` traité comme `business` + warn (§3.2bis)
- [ ] Versioning + enums (4 `plan_source`) + idempotence + fail-open conformes
- [ ] Tests de conformité
- [ ] Réponse `## Réponse — YYYY-MM-DD` + archivage done/

## Réponse attendue

Sous `## Réponse — YYYY-MM-DD`, lister les écarts + corrections. Signaler à
Robert tout invariant impossible/coûteux côté Prospection. Le mapping
`free`↔`freemium` et le refill leads sont déjà tranchés par le contrat v2
(§3.2bis, §8.4) — ne pas les ré-arbitrer.
