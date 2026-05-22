# UI-BACKLOG — Prospection

> Index vivant du travail UI/UX restant. Mis à jour à chaque session UI.
> Source du "mode build" de la team ui-polish (skill `ui-polish-team`).
> Dernière mise à jour : 2026-05-22.

## ✅ Livré (sprint UI mobile 2026-05-22) — sur staging, en attente promo prod

| Commit | Fix |
|---|---|
| `17ef9ef` | Header AppNav ne déborde plus en 768-1000px (nav icônes-seules tablette) |
| `d605f06` | /pipeline Kanban mobile : accordéon vertical + scroll-snap + polices ≥12px |
| `d23f6c1` | /prospects vue carte mobile sous md + feedback toast erreur + a11y clavier |
| `c37417c` | Toggle filtre site dans le menu hamburger mobile |
| `4c9e304` | Barre de filtres /prospects ne déborde plus sur mobile (flex-wrap) |

## ⏳ Pending — chantiers UI à traiter

### 🟡 P1 — Burger mobile : volets de filtres en accordéon
`todo/2026-05-22-burger-mobile-volets-filtres.md`
Remonter tous les filtres (Secteur, Géo, Taille, Qualité, recherche) dans
le menu hamburger en volets accordéon. Supprimer la FilterBar débordante.
Le fix `4c9e304` a déjà rendu la FilterBar non-débordante (rustine) — ce
ticket est la vraie refonte.

### 🟡 P1 — Calendrier RDV : refonte UI desktop + mobile
`todo/2026-05-22-calendrier-rdv-refonte-ui.md`
Le calendrier (`appointment-calendar.tsx`, FullCalendar) est moche
desktop et mobile. Styler avec les tokens, rendre utilisable sur 375px.

### 🟡 P1 — Audit T18 : le reste (perf /pipeline, etc.)
`todo/2026-05-22-ui-audit-fixes.md`
Ticket d'origine du sprint. Le mobile cassé est traité. Reste : perf
/pipeline (lazy-load FullCalendar déjà fait via `pipeline-view.tsx`),
+ annexes 20% (a11y lecteurs d'écran, etc. — ROI faible, à voir).

### 🟢 P2 — Calendrier : notifications + sync Google Calendar OAuth
`todo/2026-05-22-calendrier-sync-google-oauth.md`
Niveau 1 : notif/doublon Google Calendar. Niveau 2 : sync OAuth écriture
(conditionné à un scope OAuth pas trop coûteux). À cadrer.

## 🏗️ Feature produit liée à l'UI (pas du polish — du build)

### 🟡 P1 — Switch mode agence web / générique + onboarding ciblage
`todo/2026-05-22-switch-mode-agence-et-onboarding.md`
Switch global (tri par dette technique vs CA/effectif) + onboarding
(choix zones géo + secteurs au 1er login). L'onboarding actuel est
inexistant/cassé (POC jamais fini). Gros chantier dev + UI — à cadrer.

## 🐞 Bugs hors-scope UI détectés pendant le polish (à router)

- `todo/2026-05-22-patch-api-leads-405-manquant.md` — 🔴 P0 backend :
  `PATCH /api/leads/[domain]` manquant, appelé à 7 endroits.
- `todo/2026-05-22-e2e-helper-auth-supabase-mort.md` — 🟡 P1 : helper
  e2e auth pointe sur Supabase mort, 11 specs skippées en silence.

## Notes

- Convention : tout nouveau besoin UI → ajouter une ligne ici + un
  ticket détaillé `todo/YYYY-MM-DD-<slug>.md` si le sujet le mérite.
- Les bugs non-UI trouvés pendant un chantier UI → ticket séparé +
  référencés dans la section "hors-scope" ci-dessus.
