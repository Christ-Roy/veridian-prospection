# [PROSPECTION] Audit — aucun résidu trial / freemium après paiement

> **Sévérité** : 🟡 P1 (devenu P0 sur 2 gaps UI très visibles)
> **Owner** : agent Prospection (agent-R)
> **Créé** : 2026-05-24
> **Livré** : 2026-05-25
> **Demandeur** : agent Hub (audit cross-app trial)
> **Référence Hub** : `veridian-hub/docs/AUDIT-TRIAL-RESIDUS-2026-05-24.md`

---

## TL;DR

| Périmètre | État | Note |
|---|---|---|
| Webhook `update-plan` (HMAC Hub) | ✅ OK | Persiste `tenant.plan` + invariants v2 respectés |
| Endpoint `credit-leads` (welcome upgrade) | ✅ OK | Idempotence robuste, anti-double-grant par palier |
| `/api/trial` — reconnaissance plans payants | 🔴 **FIXÉ** | Listait que `pro` + `enterprise` → `business`/`starter`/`lifetime_*`/`internal` voyaient trial expiré |
| Badge nav "Essai gratuit — Xj" | 🔴 **FIXÉ** | Toujours affiché même pour plan payant |
| Badge "X / 300" page prospects | 🔴 **FIXÉ** | S'affichait dès `data.total <= 300` sans gating plan |
| Cache `planCache` (5min) non invalidé par update-plan | 🟡 **FIXÉ** | User qui upgrade restait capé jusqu'à 5min |
| Page admin-kpi (sub plan) | 🟢 **FIXÉ** | Affichait "300 leads max" + "Essai gratuit" pour business |
| Crons / emails trial côté Prospection | ✅ OK | Aucun — responsabilité 100% Hub via Notifuse |
| `checkTrialExpired` (stub `return false`) | ✅ OK | Hack documenté, sans effet hors paywall (donc inoffensif) |
| Onboarding overlay au premier signup | 🟡 **ESCALADE** | Pas gated par plan, montre des options freemium même si user a payé via Hub |

**Résultat global** : promesse Robert tenue après 4 fixes (2 P0 UI très
visibles + 1 cache stale + 1 cosmétique admin). 1 escalade restante.

---

## ✅ Section OK — ce qui était déjà conforme

### A. `tenant.plan` — source de vérité unique
- `tenant.plan` est la SoT côté Prospection (pas de table `workspace_plan`
  séparée comme côté Hub). `update-plan` met à jour cette colonne avec
  validation v2 complète.
- Preuve : `src/app/api/tenants/update-plan/route.ts` (route HMAC Hub).
- Mapping canonique → local correct (`free→freemium`, `enterprise→business`).
- Immunité plans offerts respectée (`lifetime_*`, `internal`, `grant_manual`).

### B. `credit-leads` — welcome upgrade Stripe
- `POST /api/tenants/{id}/credit-leads` accepte le delta envoyé par le Hub
  après `grantWelcomeLeadsBestEffort` (cf `prisma-sync.ts:310` Hub).
- Double idempotence : `idempotency_key` UNIQUE + `(workspace_id,
  welcome_plan)` UNIQUE → l'invariant "1 welcome par palier lifetime" est
  protégé en DB, pas seulement par la discipline du caller Hub.
- Preuve : `src/app/api/tenants/[id]/credit-leads/route.ts:70-105`.

### C. Pas de cron / mail trial côté Prospection
- `grep -rn "trialEmail\|mail.*trial\|cron.*trial" src/` → 0 résultat.
- Toute la machinerie trial (start, ending-soon, expired) vit côté Hub
  (`veridian-hub/lib/trial/run-tick.ts`). Prospection est consommateur passif.

### D. `checkTrialExpired` — stub inoffensif
- Hack `return false` documenté depuis 2026-04-06 (incident Supabase Kong).
- Appelé uniquement dans `/api/prospects` et `/api/leads/[domain]` pour
  obfusquer les champs sensibles → stub `false` = jamais d'obfuscation
  trial-driven. La promesse "client paie = pas d'obfuscation" est tenue
  par accident (mais bonne nouvelle : pas de remédiation nécessaire ici).
- Le freeze cross-app Hub §5.21 reste branché correctement.

### E. Workspaces & UI dashboard — pas de bandeau "trial" résiduel
- `grep -rn "FreemiumBanner\|TrialBanner"` → 0 (composants n'existent pas
  côté Prospection ; seul le Hub a un `FreemiumBanner`).
- Pas de modale "upgrade pour débloquer" persistante hors `Paywall` (gated
  correctement par `useTrial().isExpired`).

---

## 🔴 Section FIXÉS — corrections livrées

### Fix 1 — `/api/trial` reconnaît tous les plans payants + gifted

**Avant** : `src/app/api/trial/route.ts:43` ne reconnaissait que `pro` et
`enterprise` comme paid → un user `business` (ou `starter`,
`lifetime_*`, `internal`) reçoit `daysLeft` calculé depuis `createdAt`.
Si le user existe depuis > 7 jours (TRIAL_DAYS), `daysLeft=0` →
`isExpired=true` côté client → `Paywall` overlay s'affiche **alors qu'il
paie**.

**Après** :
- Ajout d'un set `NON_TRIAL_PLANS = {pro, business, enterprise, starter}`
  + check `isGiftedPlan()` pour `lifetime_*`/`internal`.
- Renvoie systématiquement `isExpired` côté serveur (avant : pas exposé
  hors paid path → client recalcule sur `daysLeft <= 0`).
- Fail-safe sur exception Prisma : `isExpired=false` (jamais de paywall
  par panne — doctrine Veridian).

**Fichier** : `src/app/api/trial/route.ts`

**Preuve** :
```ts
const NON_TRIAL_PLANS = new Set([
  "pro", "business", "enterprise", "starter",
]);
function isPaidOrGiftedPlan(plan: string): boolean {
  return NON_TRIAL_PLANS.has(plan) || isGiftedPlan(plan);
}
// ...
if (isPaidOrGiftedPlan(plan)) {
  return NextResponse.json(
    { daysLeft: 999, plan, isExpired: false },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
```

**Tests** : `__tests__/api/trial-residus.test.ts` — matrice 7 plans
payants (pro, business, enterprise, starter, lifetime_site_vitrine,
lifetime_partner, internal) tous renvoient `daysLeft=999, isExpired=false`.

### Fix 2 — Badge nav "Essai gratuit — Xj" gated par plan

**Avant** : `src/components/layout/app-nav.tsx:96-111` affichait
**toujours** le badge "Essai gratuit — Xj" en haut du dashboard, **même
pour un user qui paie**. Violation directe et très visible de la
promesse Robert.

**Après** :
- Variable `showTrialBadge = daysLeft < 900` (paid renvoie 999 cf Fix 1).
- Le bloc `<div>` du badge est wrappé dans `{showTrialBadge && (...)}`.
- Pour un user payant, le header montre juste le logo Veridian + titre
  "Prospection", sans aucun rappel d'essai.

**Fichier** : `src/components/layout/app-nav.tsx`

### Fix 3 — Badge "X / 300" page prospects gated par plan

**Avant** : `src/components/dashboard/prospect-page.tsx:427-431` affichait
"X / 300" avec tooltip "Quota freemium — passez au plan Geo" dès que
`data.total <= 300`. Un user `pro` fraîchement provisioné, ou avec un
filtre serré qui retourne < 300 prospects, voyait ce message **alors
qu'il paie**.

**Après** : ajout du gating `!trialState.loading && trialState.daysLeft <
900 && !trialState.isExpired` → la pastille n'est rendue que pendant un
trial actif. Pour un user payant, plus jamais de mention "300".

**Fichier** : `src/components/dashboard/prospect-page.tsx`

### Fix 4 — Invalidation cache `planCache` à `update-plan`

**Avant** : `src/lib/auth/tenant.ts:92` cache la limite plan 5min par
userId. À la réception de `update-plan plan=pro plan_source=stripe`, la
DB est mise à jour mais le cache in-memory garde l'ancienne valeur
freemium (300) jusqu'à 5 min → un user qui paie reste capé.

**Après** :
- Le cache stocke aussi `tenantId` (refactor non-breaking : nouvelle
  colonne dans la valeur, lookup retourne la limite comme avant).
- Nouvelle fonction exportée `invalidatePlanCacheForTenant(tenantId)` qui
  itère la Map et supprime toutes les entrées du tenant. Synchronous, O(N)
  où N = utilisateurs cached. No-op si tenant inconnu.
- `update-plan` route appelle cette fonction après le `prisma.tenant.update`
  réussi (avant le `console.log` final).
- Hook test-only `__planCacheInternals` (clear/size/set/get) pour les tests.

**Fichiers** :
- `src/lib/auth/tenant.ts`
- `src/app/api/tenants/update-plan/route.ts`

**Limite documentée** : cache in-memory par-process. Multi-pod nécessitera
un signal cross-pod (Redis pub/sub) — pour l'instant Prospection tourne
en singleton, le cache local suffit.

**Tests** :
- `__tests__/lib/auth/plan-cache-invalidation.test.ts` — 5 tests sur
  l'isolation par tenant, idempotence, fallback freemium sans tenantId.
- `__tests__/api/tenants/update-plan-cache-invalidation.test.ts` — 2
  tests end-to-end : update-plan réussi purge 2 entrées sur 3 (autre
  tenant intact) + update-plan sans entrée cache = no-op.

### Fix 5 — Page admin-kpi (sub plan)

**Avant** : `src/components/dashboard/admin-kpi.tsx:70` n'avait que
`enterprise` et `pro` dans son ternaire → pour `business` /
`lifetime_*` / `internal` / `starter` → fallback "300 leads max".
Et le champ "Jours restants" affichait "Essai gratuit" même pour
`daysLeft=999`.

**Après** : ternaire élargi (business + lifetime_* + internal → "Acces
illimite", starter → "5 000 leads"). Champ Jours restants : affiche "—"
si `daysLeft >= 900`, et le sub passe à "Illimite".

**Fichier** : `src/components/dashboard/admin-kpi.tsx`

---

## 🟡 Section ESCALADE — à arbitrer avec Robert

### E1 — Onboarding overlay au premier login

**Localisation** : `src/components/layout/onboarding.tsx` + déclenché
dans `src/components/dashboard/prospect-page.tsx:115` quand
`onboardingCompletedAt=null` ET `health.leadCount < 100`.

**Comportement actuel** : l'overlay propose les 4 plans (Freemium,
Decouverte+, Pro, Enterprise) à un user qui se connecte pour la 1re
fois — **sans regarder son `tenant.plan` courant**.

**Cas problématique** : un user provisionné par le Hub directement en
`plan=pro` (via Stripe Checkout réussi, ou grant manuel) qui se logge
pour la 1re fois sur Prospection va se taper l'écran "choisissez votre
plan" avec son plan déjà acheté listé. Confusion mais pas un cap dur
(il peut skip via le bouton ✕).

**Reco** : skipper l'onboarding "plan" si `tenant.plan !== "freemium"`
au mount, et aller direct sur "geo + sector". Simple :

```ts
if (tenantPlan !== "freemium") {
  setSelectedPlan(tenantPlan);
  setStep("geo");
}
```

**Pourquoi pas livré dans ce sprint** : besoin de l'info `tenant.plan`
côté client → 1 fetch supplémentaire `/api/me` ou `/api/trial` ; et un
arbitrage UX (faut-il vraiment forcer le geo+sector pour un user Pro
qui a déjà payé pour "toute la France"?). Décision business pas
technique → escalade.

### E2 — `checkTrialExpired` stub à recâbler ou retirer

**Localisation** : `src/lib/trial.ts:24` — `return false` toujours.

**État** : inoffensif aujourd'hui (le stub `false` veut dire "jamais
d'obfuscation trial-driven", ce qui est ce qu'on veut pour la promesse
Robert). Mais c'est un fusil chargé : si un dev rebranche la logique
naïvement, il peut recasser l'obfuscation pour les users payants
fraîchement upgradés (cache stale, etc.).

**Reco** : soit retirer définitivement (et le call-site dans
`/api/prospects` et `/api/leads/[domain]`), soit le recâbler proprement
en lisant `tenant.plan` (et reposer sur la limite > 300 comme déjà fait
dans le call-site). Pas urgent — escalade pour décision.

### E3 — Cache multi-pod

**Localisation** : `src/lib/auth/tenant.ts` — `planCache` en mémoire process.

**État** : OK aujourd'hui (Prospection prod tourne en singleton). À
documenter dans le memory `project_prospection_db_prod_layout` si on
passe en multi-pod un jour : il faudra un signal Redis pub/sub ou
remplacer le cache par un Redis avec TTL.

---

## Tests livrés (sabotage-test verifié)

| Test | Couvre | Sabotage qui le casse |
|---|---|---|
| `trial-residus.test.ts` | `/api/trial` reconnaît 7 plans payants | retirer un plan de `NON_TRIAL_PLANS` |
| `trial-residus.test.ts` | fail-safe exception → isExpired=false | retirer le try/catch ou changer le default |
| `plan-cache-invalidation.test.ts` | isolation par tenant | broken filter `entry.tenantId === tenantId` |
| `plan-cache-invalidation.test.ts` | idempotence | re-faire un return non-0 |
| `update-plan-cache-invalidation.test.ts` | end-to-end purge cache | retirer le `invalidatePlanCacheForTenant` call |

Tests Vitest exécutés en CI staging — pas de build local (consigne ticket).

---

## DoD

- [x] Rapport audit Prospection livré (ce fichier)
- [x] Fix(s) Prospection livré(s) : 5 fixes
- [x] Tests anti-régression côté Prospection : 3 fichiers, ~13 tests
- [x] Notification cross-app au Hub : ce fichier sert de réponse, agent
      team-lead route au Hub via les notes de promo

---

## Références

- Ticket original : `todo/2026-05-24-audit-trial-residus-prospection.md`
- Audit Hub : `veridian-hub/docs/AUDIT-TRIAL-RESIDUS-2026-05-24.md`
- Pricing source de vérité : `veridian-hub/docs/PRICING-VERIDIAN.md`
- Mapping plans canonique → local : `src/lib/billing/plans.ts`
- Promesse Robert : "client paie = AUCUN cap, AUCUN bandeau, AUCUN
  compteur visible" (figée 2026-05-21)
