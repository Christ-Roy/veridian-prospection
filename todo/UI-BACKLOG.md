# UI-BACKLOG — Prospection

> Index vivant du travail UI/UX restant. Mis à jour à chaque session UI.
> Dernière mise à jour : 2026-05-23 (post-hotfix invitations/logout en prod).

## ✅ Livré EN PROD

### Hotfix 2026-05-23 (prod `36ac917`)
- **UX logout** : SessionProvider Auth.js v5 injecté dans le root layout
  (manquait), bandeau "Connecté en tant que X — [Changer de compte]" sur
  `/login` si session active, bouton signOut compact dans la nav
  desktop + section dédiée en bas du burger mobile avec email + bouton.

### Sprint 2026-05-22 (prod `bbd6d74`)
- Burger mobile : nouveau `MobileFilterDrawer` plein écran avec volets
  accordéon (Recherche, Secteur/Sans-site, Géo, Taille, Qualité,
  toggles). Sheets imbriqués Géo/Taille/Qualité en `w-full sm:w-[400px]`.
  A11y : X de fermeture ≥44px, `focus-visible:ring` sur 5 boutons custom,
  `SheetDescription` sr-only (tue le warning Radix).
- Refonte calendrier RDV (FullCalendar) : theming OKLCH desktop + bascule
  `listWeek` sous `md` mobile, palette couleurs partagée (`appointment-colors`).
- Perf `/pipeline` : FullCalendar + LeadSheet en `next/dynamic({ssr:false})`
  → bundle initial **156 KB First Load JS** (vs ~1025 KB avant, cible
  ticket < 300 KB largement atteinte).

### Sprint mobile 2026-05-22 antérieur (prod `cb20e8c`)
- Header AppNav non-débordant en 768-1000px (nav icônes-seules tablette)
- `/pipeline` Kanban mobile : accordéon vertical + scroll-snap + polices ≥12px
- `/prospects` vue carte mobile + feedback toast erreur + a11y clavier
- Toggle filtre site dans le menu hamburger mobile
- Barre de filtres `/prospects` ne déborde plus sur mobile (flex-wrap)
- `/api/status` ne fuit plus les volumes business (→ `/api/admin/stats` authed)

## ⏳ Pending UI — à traiter

### 🟡 P1 — Pipeline view-as membre (vue impersonate)
`todo/2026-05-23-pipeline-view-as-member-impersonate.md`
Un user `visibilityScope=all` doit pouvoir filtrer le pipeline par
membre du workspace pour suivre l'état d'avancement. Backend (filtre
+ 3 garde-fous sécu obligatoires) + frontend (sélecteur + bandeau
read-only). Effort ~1 jour, tier 🔴 HAUT.

### 🟢 P2 — Calendrier : notifications + sync Google Calendar OAuth
`todo/2026-05-22-calendrier-sync-google-oauth.md`
Niveau 1 notif/doublon, niveau 2 sync OAuth écriture. À cadrer
(condition : scope OAuth Google pas trop dur à obtenir).

## 🏗️ Feature produit liée à l'UI (build, pas polish)

### 🟡 P1 — Switch mode agence + onboarding ciblage
`todo/2026-05-22-switch-mode-agence-et-onboarding.md`
Switch tri par dette technique vs CA/effectif + onboarding (zones géo +
secteurs au 1er login). L'onboarding actuel est inexistant. À cadrer
produit avant code (gros chantier).

### 🟡 P1 — Refill leads : welcome leads + UI d'achat
`todo/done/2026-05-22-refill-2-welcome-leads-grant.md` (livré en prod)
- **Welcome leads grant** : ✅ LIVRÉ EN PROD 2026-05-23 (commit `d39093b`)
  via endpoint `credit-leads source=welcome` + anti-double-grant par
  palier en DB (migration Prisma 0017).
- **UI d'achat reste à faire** — page de commande de leads + affichage
  du solde visible (décision « solde visible » tranchée 2026-05-22,
  cf memory `project_refill_leads_solde_visible`). Ticket Stripe Checkout
  côté Hub : `veridian-hub/todo/2026-05-22-refill-leads-stripe-checkout-oneshot.md`.

## Convention

- Tout nouveau besoin UI → ligne ici + ticket détaillé
  `todo/YYYY-MM-DD-<slug>.md`
- Bug non-UI trouvé pendant un chantier UI → ticket séparé hors UI-BACKLOG
- Pour le workflow ticket (todo → staging → done) : voir `todo/README.md`
