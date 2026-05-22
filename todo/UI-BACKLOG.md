# UI-BACKLOG — Prospection

> Index vivant du travail UI/UX restant. Mis à jour à chaque session UI.
> Dernière mise à jour : 2026-05-22 (fin de session sprint UI + backend).

## ✅ Livré EN PROD (sessions 2026-05-22)

Sprint UI mobile + sprint backend — tout vérifié en prod (`cb20e8c`) :
- Header AppNav ne déborde plus en 768-1000px (nav icônes-seules tablette)
- /pipeline Kanban mobile : accordéon vertical + scroll-snap + polices ≥12px
- /prospects vue carte mobile + feedback toast erreur + a11y clavier
- Toggle filtre site dans le menu hamburger mobile
- Barre de filtres /prospects ne déborde plus sur mobile (flex-wrap)
- `/api/status` ne fuit plus les volumes business (→ `/api/admin/stats` authed)

## ⏳ Pending UI — à traiter

### 🟡 P1 — /pipeline charge en 17s (perf)
`todo/2026-05-22-ui-audit-fixes.md` (#2 — les #1 et #3 sont livrés)
Lazy-load FullCalendar déjà câblé via `pipeline-view.tsx` — mesurer
l'effet réel, traiter le reste du bundle si encore lourd.

### 🟡 P1 — Burger mobile : volets de filtres en accordéon
`todo/2026-05-22-burger-mobile-volets-filtres.md`
Remonter tous les filtres (Secteur, Géo, Taille, Qualité) dans le menu
hamburger en volets accordéon. La FilterBar a déjà été rendue
non-débordante (rustine flex-wrap livrée) — ce ticket est la vraie refonte.

### 🟡 P1 — Calendrier RDV : refonte UI desktop + mobile
`todo/2026-05-22-calendrier-rdv-refonte-ui.md`
FullCalendar moche desktop et mobile. Styler aux tokens, utilisable 375px.

### 🟢 P2 — Calendrier : notifications + sync Google Calendar OAuth
`todo/2026-05-22-calendrier-sync-google-oauth.md`
Niveau 1 notif/doublon, niveau 2 sync OAuth écriture. À cadrer.

## 🏗️ Feature produit liée à l'UI (build, pas polish)

### 🟡 P1 — Switch mode agence + onboarding ciblage
`todo/2026-05-22-switch-mode-agence-et-onboarding.md`
Switch tri par dette technique vs CA/effectif + onboarding (zones géo +
secteurs au 1er login). L'onboarding actuel est inexistant. Gros chantier.

### 🟡 P1 — Refill leads : welcome leads + UI d'achat
`todo/2026-05-22-refill-2-welcome-leads-grant.md`
Le backend refill (endpoint credit-leads + quota) est LIVRÉ en prod.
Reste : welcome leads à la souscription (refill 2/3) + l'UI du refill
(page d'achat + affichage du solde — décision « solde visible » tranchée,
cf memory project_refill_leads_solde_visible).
Côté Hub : Stripe Checkout one-shot — `veridian-hub/todo/2026-05-22-refill-leads-stripe-checkout-oneshot.md`.

## Convention

Tout nouveau besoin UI → ligne ici + ticket détaillé `todo/YYYY-MM-DD-<slug>.md`.
Bug non-UI trouvé pendant un chantier UI → ticket séparé.
