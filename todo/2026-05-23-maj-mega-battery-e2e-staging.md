# [PROSPECTION] Maj mega battery E2E staging (51 tests validés, ajouter coverage manquante)

> **Type** : Dette tests / robustesse E2E
> **Sévérité** : 🟡 P1 — la batterie E2E actuelle (51 tests verts en ~70s contre staging) ne couvre pas certains chantiers livrés cette journée. Sans extension, ces zones sont en aveugle vs régression future.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert (post-promo prod 2026-05-23, sprint robustesse)

## Contexte

Le 2026-05-23, la batterie E2E lourde a été lancée contre staging avant promo prod et a passé **51/51** :
- `e2e/core/` : 43 tests (auth gating + global full flow + hub contract HMAC + invited member + prospects full flow + regression + status endpoint)
- `e2e/staging-full/critical-journeys.spec.ts` : 8 journeys (SSO Hub→Prosp + login + historique + pipeline + prospects + SW v2 + console errors)

Mais **plusieurs zones livrées dans la session ne sont PAS couvertes** par cette batterie :

### Zones non couvertes — à ajouter

#### 1. Welcome leads grant (commit `d39093b` + migration 0017)
- Smoke HMAC : POST `/api/tenants/[id]/credit-leads source=welcome welcome_plan=freemium` → vérifie row `lead_credit_events` créée, anti-double-grant idempotent (delta entre paliers)
- Validation 7/7 cas (Zod refus welcome_plan invalide, contract_version, etc.)

#### 2. Persist client errors DB (commit `3a831c9` + migration 0018)
- Smoke POST `/api/errors` avec payload réaliste → vérifie row `client_errors` créée
- Replay même payload dans la même heure → `count` incrémente (pas nouvelle row)
- Endpoint admin `/api/admin/client-errors` (requireAdmin) → groupBy correct

#### 3. UX logout / changement de compte (commit `22d400f`)
- Login en tant que A
- Visite `/login` → vérifie bandeau "Connecté en tant que A" + bouton "Changer de compte"
- Click "Changer de compte" → session vidée
- Login en tant que B → `/api/auth/session` retourne B

#### 4. Notifuse mail invitations (commit `f280013`)
- Création invitation via `/api/admin/invitations` → vérifie `emailSent` flag (true si Notifuse provisionné, false sinon best-effort non-bloquant)
- Mock Notifuse 500 → invitation toujours créée

#### 5. UI mobile burger + filter drawer (commit `4a027c3` + `35fcbc6`)
- Viewport 375px → bouton "Filtres" visible, drawer ouvre/ferme, 5 volets accordéon
- Zéro overflow horizontal mesuré (`document.scrollWidth ≤ window.innerWidth + 1`)

#### 6. Refonte calendrier RDV (commit `be93f66`)
- `/pipeline` onglet Calendrier → FullCalendar render (5 modes : month/week/day/list)
- Mobile 375px → bascule `listWeek` automatique

#### 7. Settings page overflow fix (commit `67eaa4c`)
- DÉJÀ détecté par `e2e/extended/mobile-viewport.spec.ts:84` mais à promouvoir dans `core/` ou `staging-full/` pour ne pas l'oublier
- Ajouter assertion explicite pour les 5 tabs (Affichage, Téléphonie, etc.) visibles avec scroll horizontal interne

#### 8. Code-split FullCalendar + LeadSheet (commit `d1484df` perf)
- `/pipeline` → mesure `performance.timing` First Load JS < 300 KB attendu
- Cliquer onglet Calendrier → FullCalendar charge en lazy (chunk séparé)

#### 9. Pipeline view-as member (P1 en attente cadrage)
- Quand livré : flow admin scope=all → sélecteur "Voir pipeline de Bob" → URL change → cards Bob → drag-and-drop désactivé

#### 10. Refill UI page client (P1 en attente livraison)
- Quand livré : solde visible nav + page `/settings/leads` + modale achat

## Action attendue

Étendre `e2e/core/` ou `e2e/staging-full/critical-journeys.spec.ts` (au choix selon criticité) avec les 8 zones ci-dessus (les 2 dernières restent à l'attente de leur livraison).

**Priorité 1** : welcome leads + persist client errors + UX logout (les 3 livraisons critiques sécu/billing/observability du sprint).
**Priorité 2** : Notifuse + UI mobile + calendrier + settings overflow + perf code-split.

## Méthode

Pattern container Playwright sur dev-pub (cf rapport agent `e2e-skip-vide` 2026-05-23, helper canonique `ensureCanonicalUser` désormais seed lead + invité + invitation idempotents) :

```bash
ssh dev-pub 'docker run --rm --network staging-edge \
  -v /tmp/prosp-e2e-full:/work -w /work \
  -e DATABASE_URL="postgresql://app:...@postgres-staging:5432/prospection?..." \
  -e PROSPECTION_URL="https://prospection.staging.veridian.site" \
  -e CI="1" \
  mcr.microsoft.com/playwright:v1.60.0-jammy \
  bash -c "npm ci --silent && npx playwright test e2e/core/ --project=chromium --reporter=list --workers=1"'
```

## Limitation acceptée

Les tests E2E utilisent la DB staging réelle → seed et cleanup idempotents OBLIGATOIRES (le helper canonique fait ça via upsert sur clés uniques). Ne PAS lancer la batterie contre prod sans audit préalable.

## Effort estimé

- Priorité 1 (3 zones critiques) : ~4h
- Priorité 2 (5 zones complémentaires) : ~6h
- **Total : ~1.5 jour**

## Critère de succès

- Casser volontairement le fix `d5ae9e8` (retire un guard défensif) → spec E2E rouge sur le journey concerné
- Casser le helper Notifuse → spec rouge sur invitations
- Casser la migration 0018 → spec rouge sur persist errors

## Référence

- Rapport E2E 2026-05-23 (cette session) : 51/51 verts core+staging-full
- Helper canonique : `e2e/helpers/auth.ts` (post-commit `cfbc9d4`)
- Pattern container dev-pub : commit `dcf6922` (crawler-fix)
- Cron dev-pub cleanup : commit `135ab54`
