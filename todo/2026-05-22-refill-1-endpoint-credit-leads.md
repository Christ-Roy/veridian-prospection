# [PROSPECTION] Refill leads (1/3) — endpoint `credit-leads` + quota DB

> **Type** : Feature billing — flux refill leads
> **Sévérité** : 🟡 P1 — débloque la monétisation refill (2e flux de revenu)
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Réfère** :
>   - `veridian-hub/docs/CONTRAT-BILLING.md` §8.4 (refill = flux séparé)
>   - `veridian-hub/docs/PRICING-VERIDIAN.md` §95-108 (grille dégressive)
>   - `todo/2026-05-21-business-plan-pricing-features.md` §2.3, §2.6
> **Lié** : tickets refill 2/3 (welcome leads) et 3/3 (Hub Stripe Checkout)

## ✅ DÉCISION TRANCHÉE (Robert, 2026-05-22) — solde visible, ton positif

Le solde de leads achetés **est visible** — mais formulé comme un acquis,
jamais comme une menace. La doctrine « pas de compteur visible » vise les
**limites de plan** (Free/Pro/Business), qui punissent le client de ne
pas avoir payé plus. Le solde de leads, lui, est ce que le client **a
déjà payé** : le lui cacher n'est pas « généreux », c'est lui cacher ce
qu'il possède. Les deux ne sont pas en conflit.

Règles d'implémentation UI (pour le ticket UI du refill) :
- **Indicateur discret** du solde (ex. « 4 200 leads » dans un coin),
  ton neutre. PAS de barre de progression qui se vide, PAS de rouge
  anxiogène, PAS de « plus que X ! ».
- **Pas de mur brutal à 0.** Stock bas → invitation douce à recharger.
  Stock à 0 → on ne grise pas l'app, on propose de recharger. Jamais un
  blocage sec.
- Le bouton « acheter des leads » est une **action positive offerte**,
  pas une rançon.

→ Le backend de ce ticket (endpoint, quota, décompte) est neutre
vis-à-vis de l'UX et se code tel quel. Cette décision cadre uniquement
le futur ticket UI du refill.

Tant que ce n'est pas tranché : coder le backend (neutre vis-à-vis de
l'UX), laisser l'affichage au ticket UI dédié.

## Contexte

`CONTRAT-BILLING.md` §8.4 a figé l'architecture : le refill leads est un
**flux distinct de l'abonnement** (`update-plan`). Le Hub gère seul
Stripe (Checkout one-shot), puis propage un **signal de crédit dédié**
vers Prospection. L'endpoint côté Prospection n'est pas figé par le
contrat — **c'est ce ticket qui le spécifie et l'implémente.**

État actuel du code : aucun système de quota fonctionnel. La colonne
`Workspace.leadsLimit` existe mais n'est quasi pas utilisée (1 ref dans
`admin/kpi`). Tout est à construire.

## Livrable 1 — Schéma : quota de leads par workspace

Migration Prisma additive. Le quota vit au niveau **workspace** (le
provisioning crée 1 workspace par tenant ; le refill crédite le workspace).

Champs à ajouter sur `Workspace` (ou table dédiée `lead_credits` si on
veut l'historique des achats — à choisir, voir note) :
- `leadsCredited Int @default(0)` — total de leads crédités (cumul des
  achats + welcome leads).
- `leadsConsumed Int @default(0)` — total consommé.
- Le solde = `leadsCredited - leadsConsumed`.
- Index si lookup fréquent.

Garder `leadsLimit` existant OU le remplacer — auditer son usage réel
avant (`grep leadsLimit`). Probablement legacy à nettoyer.

> Note : si on veut tracer chaque achat (montant, date, Stripe payment
> id) pour le support / la compta → table `lead_credit_events` séparée
> (append-only). Recommandé. À trancher dans l'implémentation.

## Livrable 2 — Endpoint `POST /api/tenants/[id]/credit-leads`

Reçoit le signal de crédit du Hub après un Checkout one-shot réussi.

**Auth** : HMAC Hub standard (`verifyHubHmac`, comme les autres routes
tenant-level — cf `sync-member`, `update-plan`).

**Body** (à figer dans ce ticket, puis communiquer au Hub) :
```json
{
  "quantity": 5000,
  "source": "purchase | welcome",
  "idempotency_key": "uuid-v4",
  "stripe_payment_id": "pi_... (optionnel, pour audit)",
  "contract_version": "2.0"
}
```

**Comportement** :
1. Résoudre le tenant (helper `resolveTenantByIdOrEmail` — accepte email
   ou UUID, cf ticket tenant-id déjà livré).
2. Trouver le workspace par défaut du tenant.
3. **Idempotent** : dédoublonner sur `idempotency_key` — un même signal
   rejoué ne crédite qu'une fois (cf table d'événements ou clé stockée).
4. Incrémenter `leadsCredited` de `quantity`.
5. Audit log `tenant.leads_credited`.
6. Répondre 200 `{ credited: quantity, balance: <nouveau solde> }`.

**Cas d'erreur** : 401 HMAC invalide · 404 tenant inconnu · 400 quantity
≤ 0 ou contract_version major inconnu · 422 body malformé.

**Fail-safe** : ne JAMAIS décrémenter sur ce endpoint (c'est un crédit).
Pas de webhook Stripe direct (gravé interdit, contrat §2).

## Livrable 3 — Décompte des leads consommés

Définir ce qui « consomme » un lead. D'après `PRICING-VERIDIAN.md` :
un lead = une fiche entreprise débloquée/consultée. À cadrer précisément :
- La consultation d'une fiche prospect incrémente `leadsConsumed` ?
- Idempotent par (workspace, domaine) — consulter 2× le même lead ne
  compte qu'une fois ? (sinon le client paie 2× la même boîte — à éviter).
- Où câbler le décompte : `/api/leads/[domain]` (GET) probablement.

→ Si le solde atteint 0 : comportement = décision UX (option A/B en tête
de ticket). Backend : exposer le solde via une route lisible par l'UI.

## Tests obligatoires

- `credit-leads` : HMAC valide → crédite + balance correcte ; HMAC
  invalide → 401 ; replay même `idempotency_key` → 200, crédité une
  seule fois ; quantity ≤ 0 → 400 ; tenant inconnu → 404.
- Décompte : consulter une fiche incrémente `leadsConsumed` ; re-consulter
  la même → pas de double décompte.
- Migration : test integration sur le nouveau schéma.

## Definition of Done

- [ ] `CONTRAT-BILLING.md` §8.4 + `PRICING-VERIDIAN.md` §95-108 lus
- [ ] Décision quota visible/invisible tranchée par Robert
- [ ] Migration quota appliquée (staging puis prod manuel)
- [ ] Endpoint `credit-leads` HMAC + idempotent + audit
- [ ] Décompte des leads consommés câblé + idempotent par domaine
- [ ] Schéma du body communiqué à l'agent Hub (ticket refill 3/3)
- [ ] Tests de conformité verts
- [ ] Réponse + archivage done/
