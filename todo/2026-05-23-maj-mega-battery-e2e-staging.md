# [PROSPECTION] Maj mega battery E2E staging — ULTIME test post-commercialisation

> **Type** : Filet de sécurité critique avant push prod commercialisé
> **Sévérité** : 🔴 **P0** — Robert (2026-05-23 après Stripe en prod) : "ce sera l'ultime test post-commercialisation, quand on ne pourra plus se tromper".
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert (post-promo prod 2026-05-23, sprint robustesse)

## Vision Robert — la mega battery, c'est le filet ULTIME

Quand le SaaS est commercialisé (clients qui paient en prod), on n'a
plus le droit à l'erreur. La mega battery E2E doit être **la dernière
sonde avant push main**. Si elle passe verte contre staging :
- L'app fonctionne pour un user humain réel
- Stripe + billing + invitations + tous les flows critiques tournent
- Aucune régression silencieuse n'est passée

**🚨 GATE DE PROMO PROD — durci 2026-05-23**

Robert (2026-05-23) : « **pas de push prod avant mise à jour de la giga
batterie de test e2e lourde et le passage de ces tests sur staging quand
livré.** »

Concrètement :

1. **Toute livraison de feature** (mail, refill UI, switch agence, onboarding,
   timeline prospect, pipeline stages custom, view-as member, etc.) **DOIT**
   ajouter sa couverture E2E dans la mega battery AVANT que la feature ne
   soit candidate à la promo prod.
2. **La mega battery DOIT passer verte 100% contre staging** avec la
   feature livrée, sinon promo prod **interdite**.
3. **Le team-lead refuse toute promo `staging → main`** tant que :
   - La feature livrée n'a pas son extension de mega battery
   - La mega battery complète n'a pas passé verte sur staging avec le
     SHA candidat
4. **Pas d'exception** sauf tier 💀 CRITIQUE arbitré par Robert
   directement (rollback hotfix, rotation secret en urgence).

Cette règle remplace l'ancienne politique "auto-promote tier 🟢 BAS"
quand la livraison touche du périmètre fonctionnel. Les commits doc-only
(todo/*, README.md, .md) restent en auto-promote `[risk:low]` sans
gating mega battery — ils ne touchent pas le code applicatif.

## Flows critiques à couvrir EN PRIORITÉ (commercialisation)

### 🔴 Tier 1 — bloque toute promo prod si manquant

#### Stripe billing end-to-end (livré prod via Hub)
- User Pro upgrade → Stripe Checkout test mode → webhook Hub `subscription.updated` → Hub appelle `update-plan` → DB Prospection reflète plan
- Refill leads achat one-shot → Stripe Checkout test mode → webhook → `credit-leads source=purchase` → balance `leadsCredited` incrémentée
- Cancellation → trial state machine → 5 mails → 2j → 15j → downgrade automatique
- Anti-double-charge : replay même `idempotency_key` → no-op 200

#### Invitations cross-app (sujet du bug 2026-05-23 — 5j en silence)
- Admin crée invitation `/admin/invitations` → row DB + Notifuse mail envoyé (ou fallback copier-coller si Notifuse down)
- User accepte invitation `/invite/[token]` + password → User+Account+WorkspaceMember créés Prisma → `signIn("credentials")` → session valide
- Sabotage-test : si quelqu'un re-introduit Supabase Auth (gotrue mort) → spec rouge en < 30s
- Replay token déjà accepté → 404 explicite

#### Login Hub→Prosp autologin (HMAC + cookie session)
- Hub appelle `/api/tenants/provision` HMAC standard `{ts}.{body}` → token one-shot persisté
- Browser ouvre `/api/auth/token?t=<token>` → cookie `__Secure-authjs.session-token` posé → redirect `/prospects`
- Token expire 24h, one-shot (replay → 404)
- Race cookie déjà géré (cf bug 401 fixé commit `67d7e38`)

#### Multi-tenant isolation (sécu sensible)
- User A workspace X tente lire data workspace Y → 403/404 systématique
- Manager scope=all voit pipeline membres du SIEN workspace, jamais d'un autre
- Helper `getWorkspaceFilter` ne fuit jamais cross-tenant

### 🟡 Tier 2 — important pour confiance client

#### Welcome leads grant (commit `d39093b` + migration 0017)
- Smoke HMAC : POST `/api/tenants/[id]/credit-leads source=welcome welcome_plan=freemium` → +100 leads
- Anti-double-grant idempotent (delta entre paliers) → upgrade freemium→pro = +1900 not +2000
- Validation Zod 7/7 cas (welcome_plan requis si source=welcome, interdit si source=purchase, etc.)

#### Persist client errors DB (commit `3a831c9` + migration 0018)
- POST `/api/errors` payload réaliste → row `client_errors` créée
- Replay même payload dans la même heure → `count` incrémente (pas nouvelle row)
- Anti-loop : `/api/errors` retourne 204 même si DB down (sinon ClientErrorBoundary re-POST l'erreur DB et boucle)
- Endpoint admin `/api/admin/client-errors` requireAdmin → groupBy correct

#### UX logout / changement de compte (commit `22d400f`)
- Login en tant que A
- Visite `/login` → bandeau "Connecté en tant que A" + bouton "Changer de compte"
- Click → session vidée → login en tant que B → `/api/auth/session` retourne B
- Mobile burger → bouton signOut visible avec email du compte

#### Notifuse mail invitations (commit `f280013`)
- Création invitation → vérifie `emailSent` flag (true si Notifuse provisionné, false sinon best-effort non-bloquant)
- Mock Notifuse 500 → invitation toujours créée (anti-bloquant absolu)

### 🟢 Tier 3 — UX confort

#### UI mobile burger + filter drawer (commit `4a027c3` + `35fcbc6`)
- Viewport 375px → bouton "Filtres" visible, drawer ouvre/ferme, 5 volets accordéon
- Zéro overflow horizontal mesuré (`document.scrollWidth ≤ window.innerWidth + 1`)

#### Refonte calendrier RDV (commit `be93f66`)
- `/pipeline` onglet Calendrier → FullCalendar render desktop
- Mobile 375px → bascule `listWeek` automatique

#### Settings page overflow fix (commit `67eaa4c`)
- DÉJÀ détecté par `e2e/extended/mobile-viewport.spec.ts:84` mais à promouvoir dans `core/` ou `staging-full/`
- Assertion explicite : 5 tabs visibles avec scroll horizontal interne (pas viewport)

#### Code-split FullCalendar + LeadSheet (commit `d1484df`)
- `/pipeline` → First Load JS < 300 KB attendu (vs ~1025 KB avant)
- Clic onglet Calendrier → FullCalendar charge en lazy

### 🔵 Tier 4 — features futures à brancher quand livrées

#### Pipeline view-as member (P1 en attente cadrage)
- Admin scope=all → sélecteur "Voir pipeline de Bob" → URL change → cards Bob → drag-and-drop désactivé

#### Refill UI page client (P1 en attente livraison Hub Stripe Checkout)
- Solde visible nav + page `/settings/leads` + modale achat

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
