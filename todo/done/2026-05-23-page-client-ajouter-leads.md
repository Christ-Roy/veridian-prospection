# [PROSPECTION] Page client "Ajouter des leads" (refill UI)

> **Type** : Feature UI client (front + lien Hub Stripe)
> **Sévérité** : 🟡 P1 — sans cette page, le client ne PEUT PAS acheter de leads. Le backend est livré (endpoint credit-leads) mais aucune UI ne le déclenche côté user. Bloque la commercialisation.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert

## Existant (déjà livré, à brancher)

### Backend Prospection — ✅ complet
- `POST /api/tenants/[id]/credit-leads` (HMAC, source=welcome|purchase, anti-double-grant par palier welcome, migration Prisma 0017 prod). Appelé par le Hub après Stripe Checkout, pas directement par le client.
- `Workspace.leadsCredited` + `Workspace.leadsConsumed` en DB (solde = `credited - consumed`).
- `src/lib/queries/lead-quota.ts` + `lead-credits.ts` + `leads.ts` : helpers consommation idempotente par (workspace, siren).

### Backend Hub — ⏳ ticket pendant
- `veridian-hub/todo/2026-05-22-refill-leads-stripe-checkout-oneshot.md` : Stripe Checkout one-shot. Le Hub crée la session Checkout, redirige vers Stripe, le webhook appelle `credit-leads source=purchase` côté Prospection.
- Pricing dégressif par tranche + plan : `shared/pricing/refill.ts` — déjà câblé dans le submodule.

### Pricing (dégressif par plan + tranche, cf submodule `shared`)
| Plan | 1-99 | 100-999 | 1k-9k | 10k-49k | 50k+ |
|---|---|---|---|---|---|
| Freemium | 0,50€ | 0,40€ | 0,30€ | — | — |
| Pro | 0,30€ | 0,25€ | 0,18€ | 0,12€ | — |
| Business | 0,20€ | 0,15€ | 0,10€ | 0,06€ | 0,04€ |

Cap : `MAX_LEADS_PER_REFILL_ORDER = 100 000`.

## Ce qu'il manque côté Prospection

### 1. Page UI `/settings/leads` ou `/billing/leads` (à trancher)

**Reco emplacement** : `/settings/leads` — la billing user vit déjà sur le Hub (`app.veridian.site/billing`). Sur Prospection, le client gère sa data, donc `/settings/leads` est cohérent. À discuter si Robert veut séparer.

**Contenu** :
- **Solde visible** (en gros, en haut) : `<X> leads disponibles` (= `leadsCredited - leadsConsumed`). Décision Robert 2026-05-22 : solde POSITIF visible et rassurant, ≠ limites de plan invisibles (cf memory `project_refill_leads_solde_visible`).
- **Historique conso** (table ou liste) : N derniers `lead_credit_events` (purchase + welcome + consumption) avec date, source, quantité, balance après. Lit `lead_credit_events` (table existante).
- **CTA "Acheter des leads"** : ouvre une modale avec :
  - Slider ou input quantité (validation min=1, max=100000)
  - Affichage prix calculé en live via `calculateRefillCostCents(plan, quantity)` (du submodule shared)
  - Bouton "Payer" → POST `/api/billing/refill-checkout` qui CALL le Hub via HMAC → reçoit `checkout_url` → window.location vers Stripe Checkout (chez le Hub)
  - Le redirect post-Stripe ramène sur `/settings/leads?refill=success` (ou `?refill=cancelled`)

### 2. Endpoint Prospection → Hub `/api/billing/refill-checkout`

Nouveau handler Prospection qui :
- `requireAuth()` user du workspace
- Reçoit `{quantity}` body Zod
- Lit le plan courant du tenant + le `tenantId` de l'user
- Calcule le prix attendu (sanity côté Prospection avant délégation au Hub)
- Call Hub via HMAC standard : `POST {HUB_URL}/api/billing/refill-checkout` body `{tenant_id, workspace_id, plan, quantity}` (à coordonner avec l'agent Hub)
- Retourne `{checkout_url}` au client

### 3. Refresh du solde après retour Stripe

- Au redirect Stripe → page `/settings/leads?refill=success` → polling court (3s × 3 = ~10s max) sur `/api/me/leads-balance` pour attraper le webhook Hub→Prospection qui a entre-temps incrémenté `leadsCredited`
- Toast de succès dès que le delta est visible
- Si polling timeout sans incrément, message "Paiement reçu, votre solde sera mis à jour dans quelques minutes"

### 4. Indicateur du solde dans la nav (perma-visible)

- Petit badge dans `app-nav.tsx` à côté de `NotificationBell` : `💎 <N>` leads (couleur indicateur si < 50 = orange, < 10 = rouge)
- Click → redirige vers `/settings/leads`
- Mobile : dans le burger menu, section dédiée "Solde leads"

## Design system

- shadcn/ui `Card`, `Button`, `Dialog` (modale achat), `Slider` ou `Input type=number`, `Table` (historique)
- Tokens OKLCH (`primary`, `success`, `warning`, `destructive`)
- Responsive : mobile-first, slider/input adaptés tactile, modale plein écran sous `md`

## Sécurité

- Validation `quantity` côté serveur (1 ≤ qty ≤ 100000), pas confiance client
- Le prix affiché côté front est INFORMATIF — le Hub recalcule à partir du tenant_id+plan reçu et c'est SA valeur qui part dans Stripe (anti-tampering)
- `requireAuth()` + `getUserContext()` pour s'assurer que l'user demandeur est bien membre du workspace cible (pas de cross-tenant)

## Tests

- Vitest unit : endpoint `/api/billing/refill-checkout` (mock Hub HMAC), validation Zod, calcul prix
- Source-level test sur le composant page : solde affiché, modale ouvre/ferme, CTA appelle bien l'endpoint
- E2E (sprint coverage flows entiers) : flow complet user clique acheter → checkout Stripe test mode → webhook Hub → polling refresh → solde mis à jour

## Coordination avec agent Hub

L'endpoint Hub `/api/billing/refill-checkout` doit exister côté Hub. Cf `veridian-hub/todo/2026-05-22-refill-leads-stripe-checkout-oneshot.md`. Si ce ticket Hub n'est pas livré, l'UI Prospection peut être mockée temporairement (modale + bouton désactivés avec tooltip "Bientôt").

## Effort

- Endpoint Prospection : ~2h (HMAC, Zod, sanity prix)
- Page UI `/settings/leads` + historique + modale : ~4h
- Badge nav perma + responsive : ~1h
- Tests Vitest + source-level : ~2h
- **Total : ~1 jour**. Tier 🟡 MOYEN (UI dashboard + sortant Hub HMAC).

## Coordination cross-app

- Hub doit avoir `/api/billing/refill-checkout` + le webhook Stripe qui call `credit-leads` côté Prospection (ticket existant)
- Si pas encore livré → coordonner avec agent Hub avant de spec'er côté Prospection en détail

## Définition de done

- [ ] Page `/settings/leads` affiche solde + historique
- [ ] Modale achat avec calcul prix live
- [ ] Endpoint `/api/billing/refill-checkout` Prospection→Hub câblé
- [ ] Refresh du solde post-redirect Stripe
- [ ] Badge nav perma desktop + mobile
- [ ] Tests Vitest + sabotage-test
- [ ] Smoke staging end-to-end (avec Stripe test mode)

## Référence

- Backend Prospection : `src/app/api/tenants/[id]/credit-leads/route.ts`, `src/lib/queries/lead-{credits,quota}.ts`, `Workspace.leadsCredited/Consumed`
- Memory décision solde visible : `project_refill_leads_solde_visible`
- Pricing dégressif : `shared/pricing/refill.ts` (submodule)
- Hub ticket : `veridian-hub/todo/2026-05-22-refill-leads-stripe-checkout-oneshot.md`
