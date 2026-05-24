# [PROSPECTION] Refill leads — filtres fins (secteur, zone géo, taille, ICP)

> **Type** : Refonte produit billing — UX et back
> **Sévérité** : 🔴 P0 — différenciateur produit vs Apollo/Cognism/Lusha
> **Owner** : agent Prospection (full stack)
> **Créé** : 2026-05-25 par team-lead Hub
> **Demandeur** : Robert
> **Refs** :
> - Pricing actuel : `shared/pricing/refill.ts` (grille dégressive 0,50€ → 0,04€/lead)
> - UI refill Hub : `veridian-hub/app/dashboard/refill-leads/page.tsx` (commit `b71c83a`)
> - Ticket parent : `2026-05-25-ui-refill-leads-entrypoint-redirect-hub.md`

---

## 0. Le problème actuel

Le refill leads tel que livré aujourd'hui = **slider quantité brute** : "Acheter N leads pour X €, crédités à vie sur ton workspace".

**Problème UX produit** : un client qui paie 500 leads veut **500 leads PERTINENTS pour sa cible**, pas 500 leads aléatoires de la base. C'est l'argument différenciant face à Apollo (filtres trop larges, base sale) ou Cognism (cher, B2B uniquement).

Robert : *"il faut qu'il puisse être plus fin sur prospection pour avoir des leads liés à ce que le prospect veut genre zone géographique, secteur et autres"*

## 1. Vision produit

L'utilisateur **décrit son ICP** (Ideal Customer Profile) **avant de payer**, puis paie pour récupérer le lot de leads matchant ce filtre. Workflow :

1. User va sur "Acheter des leads" (depuis Prospection ou via redirect Hub)
2. **Configurateur ICP** :
   - **Zone géographique** : pays + régions/départements multi-select (FR départements, EU pays, monde régions)
   - **Secteur d'activité** : NAF/SIC code multi-select OU recherche textuelle ("restauration", "tech", "services B2B")
   - **Taille entreprise** : range employés (1-10, 11-50, 51-200, 200+)
   - **Chiffre d'affaires** : range CA si data dispo (optionnel)
   - **Ancienneté** : créée < 2 ans, 2-5 ans, 5-10 ans, > 10 ans
   - **Tags qualifiants** : recrutement actif, levée de fonds, growth signals (déjà features Business plan)
3. **Preview live** : "Estimation : ~3 400 leads disponibles matchant ce filtre"
4. **Slider quantité** : 50 à min(disponible, plan cap)
5. **Prix calculé** : grille existante (0,50€ → 0,04€/lead) potentiellement modulée par "qualité" du filtre (premium qualifié = +20% ? à arbitrer)
6. **Checkout Stripe one-shot** (toujours via Hub, CONTRAT-BILLING §8.4 inchangé)
7. Post-paiement : Prospection génère le lot **filtré** et crédite leads + metadata source du filtre

## 2. Périmètre back Prospection

### 2.1 Endpoint preview ICP

```
POST /api/leads/estimate-count
Auth : session user (pas HMAC, c'est UI-facing)
Body : { country?, regions?, sectors?, employeeRange?, revenueRange?, ageRange?, qualifiers? }
Réponse : { estimated_count: 3400, plan_cap: 50000, max_orderable: 3400 }
```

Lit le data lake / DB prospection pour compter sans expose les leads (anti-scraping).

### 2.2 Évolution endpoint credit-leads

Le contrat HMAC existant `POST /api/tenants/{id}/credit-leads` reçoit aujourd'hui `{quantity, source, idempotency_key, contract_version}`. À étendre :

```json
{
  "quantity": 500,
  "source": "purchase",
  "idempotency_key": "...",
  "contract_version": "2.1",  // ← bump car shape change
  "stripe_payment_id": "pi_...",
  "filters": {                  // ← NOUVEAU
    "country": "FR",
    "regions": ["75", "92", "93"],
    "sectors": ["56.10A", "56.10B"],
    "employee_range": { "min": 10, "max": 50 },
    "qualifiers": ["recrutement_actif"]
  }
}
```

Prospection génère le lot matchant ces filters au moment du credit, crédite leads + stocke la source du filtre dans `lead_orders.filters_json` pour audit / re-livraison si besoin.

### 2.3 Migration DB Prospection

Nouvelle table `lead_orders` (audit trail) :

```sql
CREATE TABLE lead_orders (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  quantity INT NOT NULL,
  source TEXT NOT NULL,  -- 'purchase' | 'welcome'
  filters_json JSONB,
  stripe_payment_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 3. Périmètre UI Prospection

Configurateur ICP riche dans `/leads/buy` (ou équivalent dans la nav). Composants :

- `SectorMultiSelect` (recherche NAF + tags rapides "Restauration / Tech / Services / Industrie / Retail")
- `GeoMultiSelect` (carte FR cliquable + dropdown départements + presets "IDF, Rhône-Alpes, etc.")
- `EmployeeRangeSlider`
- `LiveCountPreview` (debounced 300ms, appelle estimate-count)
- `OrderSummary` (filtres choisis + count + prix calculé + CTA "Acheter X leads")
- Redirection vers Hub `/dashboard/refill-leads?from=prospection&tenant=...&filters=<base64>` avec filters serialisés en query param

## 4. Périmètre Hub (modif legère)

Le Hub doit accepter le param `?filters=<base64-json>` dans `/dashboard/refill-leads`, le poser dans `metadata` Stripe Checkout, le webhook le reçoit et le forward dans le body `credit-leads`. **Le Hub ne valide PAS les filtres** (responsabilité Prospection), il les transporte.

Ticket Hub à créer : `veridian-hub/todo/2026-05-25-refill-leads-forward-icp-filters.md`

## 5. Implications pricing

À arbitrer avec Robert :

**Option A — Prix uniforme** : grille existante s'applique, filtre = bonus produit sans surcoût (simple, généreux, cohérent avec philo Veridian "tout illimité")

**Option B — Premium qualifié** : leads avec qualifiers Business (recrutement_actif, growth signals) → +20-30% du prix. Plus complexe mais monétise mieux la valeur premium.

**Reco** : Option A pour v1 (simplicité, time-to-market, on mesure l'adoption avant de complexifier). Option B en v2 si data montre que les filtres premium sont massivement utilisés.

## 6. Définition of done

- [ ] Endpoint `/api/leads/estimate-count` livré + tests
- [ ] Migration DB `lead_orders` + Prisma model
- [ ] Endpoint `credit-leads` étendu pour accepter `filters` (contract_version bump 2.1)
- [ ] Configurateur ICP UI Prospection livré (5 composants)
- [ ] Ticket Hub déposé pour forward filters via metadata Stripe
- [ ] Spec E2E bout-en-bout : config ICP → preview → checkout → webhook → credit avec lot filtré → audit lead_orders
- [ ] Doc UX dans `prospection/docs/UX-REFILL-ICP.md`
- [ ] Push staging

## 7. Estimation

- Back (estimate-count + credit-leads ext + migration) : ~6h
- UI configurateur ICP (5 composants Radix + carte) : ~12h
- E2E + tests Nuclear : ~3h
- Doc + coordination Hub : ~1h
- **Total : ~3 jours-personne**

Gros morceau mais c'est LE différenciateur produit. Refill brute = commodity, refill ICP-targeted = vraie valeur.

## 8. Pré-requis avant attaque

- Audit data Prospection : quelle qualité de tagging existe sur la base actuelle ? (NAF, employee count, tags qualifiants)
- Si la base actuelle est trop pauvre pour ces filtres → ticket P0 préliminaire "enrichir la base avec NAF + INSEE employee count + scraping growth signals"

## 9. Coordination

- Avant code : Robert valide pricing (Option A vs B), liste exhaustive des filtres MVP, ergonomie configurateur (panneau latéral vs modal vs page dédiée)
- Hub : sync via ticket `veridian-hub/todo/2026-05-25-refill-leads-forward-icp-filters.md` (à créer après validation Robert)
