# [PROSPECTION] Refill leads — page native ICP avec filtres fins + checkout Stripe via Hub

> **Type** : Feature billing — UI native Prospection + intégration HMAC Hub
> **Sévérité** : 🔴 P0 — différenciateur produit vs Apollo/Cognism/Lusha
> **Owner** : agent Prospection (full stack) + coordination Hub
> **Créé** : 2026-05-25 par team-lead Hub (consolidation)
> **Demandeur** : Robert
> **Refs** :
> - Page Hub actuelle (générique) : `veridian-hub/app/dashboard/refill-leads/page.tsx`
> - Contrat : `veridian-hub/docs/CONTRAT-BILLING.md` §8.4 (Hub = seul interlocuteur Stripe)
> - Pricing : `shared/pricing/refill.ts` (grille dégressive 0,50€ → 0,04€/lead)
> - Ticket Hub coordination : `veridian-hub/todo/2026-05-25-refill-checkout-from-app-hmac-route.md`
> - Validation flow réel : test bout-en-bout du 2026-05-25 confirme que checkout+webhook+credit-leads fonctionnent

---

## 0. Vision produit (décision Robert)

L'utilisateur Prospection doit pouvoir **acheter des leads ciblés** depuis
**SA propre app Prospection** (UX native, pas un détour Hub), avec des
**filtres fins** (secteur, géo, taille, qualifiers) — différenciateur clé
vs Apollo/Cognism/Lusha qui vendent du brute.

L'user **reste dans Prospection** tout le temps, sauf pour la page Stripe
Checkout hostée par Stripe.

## 1. Architecture (frontière Hub ↔ Prospection)

| Couche | Owner | Justification |
|---|---|---|
| **UI riche refill** (configurateur ICP, preview, slider) | **Prospection** | UX native = différenciateur produit. L'app connaît ses filtres possibles |
| **Endpoint preview count** (estimate-leads-matching) | **Prospection** | L'app a la base de leads, elle seule peut compter |
| **Création Stripe Checkout Session** | **Hub** (via HMAC) | CONTRAT-BILLING §8.4 — 1 Customer Stripe/humain, audit centralisé |
| **Stripe Customer / Subscriptions / Invoices** | **Hub** | Idem §8.1 |
| **Webhook Stripe handler** | **Hub** | 1 endpoint webhook = 1 audit log centralisé |
| **Dispatch credit-leads + filtres** | **Hub → Prospection** | HMAC contract existant, étendu pour forward `filters` |
| **Génération du lot filtré + crédit DB** | **Prospection** | L'app génère le lot matchant les filtres reçus du Hub |

**Schéma flow** :
```
User dans Prospection
  └─ /leads/buy (page native Prospection riche)
      └─ configure ICP (secteur, géo, taille)
          └─ click "Acheter 500 leads filtrés — 125 €"
              └─ POST /api/refill/start (route interne Prospection)
                  └─ HMAC → POST <hub>/api/billing/refill-leads/checkout-from-app
                      └─ Hub crée Stripe Checkout Session
                          └─ metadata: { kind, app, hub_tenant_id, quantity,
                                         refill_tier, filters_json }
                          └─ return { url }
                  └─ Prospection redirige user → url Stripe Checkout
                      └─ User paie sur checkout.stripe.com
                          └─ Stripe webhook → Hub
                              └─ Hub dispatcher → HMAC POST
                                <prospection>/api/tenants/{id}/credit-leads
                                  body: { quantity, source:'purchase',
                                          filters: <forwarded>, ... }
                              └─ Prospection génère le lot matchant filtres
                                  └─ workspaces.leads_credited += quantity
                                  └─ lead_orders.filters_json = ...
                                  └─ redirect user → /leads (success toast)
```

## 2. Livrables côté Prospection

### 2.1 Page native `/leads/buy` (ou équivalent dans la nav)

**Configurateur ICP** — composants à créer dans `src/components/billing/refill-icp/` :

- `SectorMultiSelect.tsx` — recherche NAF + tags rapides ("Restauration",
  "Tech", "Services B2B", "Industrie", "Retail")
- `GeoMultiSelect.tsx` — carte FR cliquable + dropdown départements +
  presets ("IDF", "Rhône-Alpes", "Tout France", "Europe")
- `EmployeeRangeSlider.tsx` — range slider 1-1000+
- `RevenueRangeSlider.tsx` — range slider CA si data dispo (optionnel v1)
- `AgeRangeSelect.tsx` — entreprise créée < 2 ans / 2-5 / 5-10 / > 10 ans
- `QualifierTagsSelect.tsx` — tags Business plan (recrutement actif, levée
  de fonds, growth signals) — gated sur plan business
- `LiveCountPreview.tsx` — debounced 300ms, appelle `/api/leads/estimate-count`
- `OrderSummaryCard.tsx` — récap filtres + count + prix calculé (via
  `shared/pricing/refill.ts:calculateRefillCostCents`) + CTA "Acheter"

### 2.2 Endpoint preview `POST /api/leads/estimate-count`

- Auth : session user (UI-facing)
- Body : `{ country?, regions?, sectors?, employeeRange?, revenueRange?,
  ageRange?, qualifiers? }`
- Réponse : `{ estimated_count: 3400, plan_cap: 50000, max_orderable: 3400 }`
- Lit le data lake / DB Prospection pour compter SANS exposer les leads
  (anti-scraping)
- Rate-limit raisonnable (10/min/user pour anti-DoS sur compute coûteux)

### 2.3 Endpoint `POST /api/refill/start`

- Auth : session user
- Body : `{ quantity, filters: { country, regions, sectors, ... } }`
- Action :
  1. Valide filters Zod
  2. Re-compte avec estimate-count (sanity check : quantity <= max_orderable)
  3. Récup tenantId du workspace user
  4. **HMAC call → Hub** :
     ```
     POST https://app.veridian.site/api/billing/refill-leads/checkout-from-app
     Headers: HMAC Pattern A (PROSPECTION_HUB_API_SECRET)
     Body: {
       tenant_id, quantity, plan (du tenant),
       filters_json (forward inchangé),
       successUrl, cancelUrl
     }
     ```
  5. Reçoit `{ url, sessionId }`
  6. Return cette URL à l'UI Prospection
- L'UI fait `window.location.href = url` → page Stripe Checkout

### 2.4 Endpoint `POST /api/tenants/{id}/credit-leads` — ÉTENDU

Le contrat HMAC existant (`source: 'purchase' | 'welcome'`) reçoit
maintenant aussi `filters` (optionnel sur welcome, requis sur purchase v2+) :

```json
{
  "quantity": 500,
  "source": "purchase",
  "idempotency_key": "...",
  "contract_version": "2.1",  // ← bump
  "stripe_payment_id": "pi_...",
  "filters": {                  // ← NOUVEAU sur purchase
    "country": "FR",
    "regions": ["75", "92", "93"],
    "sectors": ["56.10A", "56.10B"],
    "employee_range": { "min": 10, "max": 50 },
    "qualifiers": ["recrutement_actif"]
  }
}
```

Quand `filters` est posé : Prospection **génère le lot matchant ces filters
au moment du credit**, crédite leads + stocke source du filtre dans
`lead_orders.filters_json` pour audit / re-livraison si besoin.

**Backward compat** : si `filters` absent → comportement actuel
(`credit-leads` générique). Permet rollout progressif sans casser
l'existant.

### 2.5 Migration DB `lead_orders`

```sql
CREATE TABLE lead_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  quantity INT NOT NULL,
  source TEXT NOT NULL,  -- 'purchase' | 'welcome'
  filters_json JSONB,
  stripe_payment_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lead_orders_workspace ON lead_orders(workspace_id);
```

Note migration : `Existing tenants:` les workspaces existants ont déjà
`leads_credited > 0` mais aucun `lead_orders` row historique — c'est
attendu, la table commence à partir de la migration. Pas de backfill
nécessaire.

## 3. Coordination ticket Hub (à créer)

Ticket Hub correspondant : `veridian-hub/todo/2026-05-25-refill-checkout-from-app-hmac-route.md`

Ce que le Hub doit livrer en parallèle :

1. **Nouvelle route** `POST /api/billing/refill-leads/checkout-from-app`
   - Auth : HMAC Pattern A entrant (PROSPECTION_HUB_API_SECRET)
   - Wrappe la logique existante de `app/api/billing/refill-leads/checkout/route.ts`
   - Reçoit `tenant_id, quantity, plan, filters_json, successUrl, cancelUrl`
   - Pose `filters_json` dans `metadata.filters_json` Stripe (jusqu'à 500 chars,
     truncate si trop long, ou stocker en DB Hub avec ref dans metadata)
   - Return `{ url, sessionId }`

2. **Dispatcher webhook étendu** (`utils/stripe/dispatcher.ts` ou équivalent)
   - Quand `metadata.kind === 'refill_leads'` + `metadata.filters_json` existe
   - Forward `filters_json` dans le body `credit-leads` HMAC
   - Backward compat : si pas de `filters_json`, body inchangé (`credit-leads`
     v2.0 actuel)

3. **Bump contract_version 2.0 → 2.1** dans `docs/CONTRAT-BILLING.md`
   - Documenter `filters` optionnel sur `purchase`
   - Documenter la route `checkout-from-app` HMAC pattern A

## 4. Implications pricing (à arbitrer)

**Option A — Prix uniforme** : grille existante s'applique, filtre = bonus
produit sans surcoût (simple, généreux, cohérent avec philo Veridian
"tout illimité")

**Option B — Premium qualifié** : leads avec qualifiers Business
(recrutement_actif, growth signals) → +20-30% du prix

**Reco par défaut** : Option A pour v1. Mesure l'adoption avant de
complexifier.

## 5. Definition of done

### Côté Prospection
- [ ] Migration `lead_orders` Prisma + push staging
- [ ] Endpoint `/api/leads/estimate-count` + tests Nuclear
- [ ] Endpoint `/api/refill/start` + tests (mock HMAC Hub call)
- [ ] Endpoint `/api/tenants/[id]/credit-leads` étendu pour `filters` (contract_version 2.1)
- [ ] Logique génération lot filtré au credit
- [ ] 7 composants UI ICP livrés
- [ ] Page `/leads/buy` cablée
- [ ] Tests Nuclear sur tous les nouveaux libs/routes
- [ ] E2E spec dédiée : config ICP → preview → checkout → webhook → credit avec lot filtré → audit `lead_orders`

### Côté Hub (ticket parallèle)
- [ ] Route `/api/billing/refill-leads/checkout-from-app` HMAC
- [ ] Dispatcher étendu pour forward `filters_json`
- [ ] Doc `CONTRAT-BILLING.md` v2.1 publiée
- [ ] Tests Nuclear

### Coordination
- [ ] Audit data Prospection : qualité tagging actuel (NAF, employee count, qualifiers) — si trop pauvre, ticket P0 préliminaire enrichissement base
- [ ] Validation Robert : pricing Option A vs B, liste exhaustive filtres MVP, ergonomie (panneau latéral vs modal vs page dédiée)
- [ ] Spec MEGA-E2E correspondante dans `veridian-hub/e2e/staging-full/mega/billing/`

## 6. Estimation

- Back Prospection (estimate-count + refill/start + credit-leads ext + migration + génération lot filtré) : ~10h
- UI configurateur ICP (7 composants Radix + carte FR) : ~12h
- Coordination Hub (route HMAC + dispatcher forward + doc) : ~4h
- E2E + tests Nuclear bout-en-bout : ~4h
- Doc UX + coordination Robert : ~2h
- **Total : ~4 jours-personne** (parallélisable entre agents Prosp + Hub)

## 7. Pourquoi pas Stripe direct dans Prospection (CONTRAT-BILLING §8.4)

Tentation naturelle : "puisque l'UI est dans Prosp, autant que Prosp
appelle Stripe directement". On garde la frontière Hub car :

1. **1 humain = 1 Stripe Customer = 1 portail facturation unique**.
   Sinon Bob qui a Notifuse Pro + Prospection Pro = 2 Customers = 2 cartes
   à enregistrer = 2 historiques de factures séparés. Comptable malheureux.

2. **Compte Stripe centralisé** = source de vérité business unique. Si
   chaque app écrit dedans, en 6 mois c'est un patchwork (cf le compte
   pré-pivot qu'on vient juste de nettoyer).

3. **Webhook fan-out > N webhooks** : 1 endpoint Hub fait le routing via
   `metadata.app`, vs N endpoints à maintenir/sécuriser/dédupliquer.

4. **Refactor pricing future** : 1 codebase (Hub) à toucher au lieu de N.

C'est exactement la même décision qu'**OAuth Couche 4 bounce** : l'UI est
libre, le backend est centralisé. Différence : OAuth nécessite redirect
OAuth provider (donc bounce visible côté user), Stripe Checkout est de
toute façon une page externe Stripe — donc l'user ne voit JAMAIS Hub
visuellement, il reste dans Prospection puis va sur Stripe puis revient
Prospection.

## 8. Pré-requis avant attaque

- [ ] Audit data Prospection : quels filtres sont **réalistes** (data déjà
  taggée) vs **aspirationnels** (à enrichir d'abord) ?
- [ ] Si filtres aspirationnels nécessitent enrichissement base : ticket
  P0 préliminaire séparé (scraping INSEE employee count, NAF normalisé,
  growth signals)
- [ ] Validation Robert sur les 5-10 filtres MVP (commencer simple)
