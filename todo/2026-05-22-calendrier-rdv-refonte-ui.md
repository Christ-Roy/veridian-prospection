# [PROSPECTION] Calendrier RDV — refonte UI (desktop + mobile)

> **Type** : UI/UX
> **Sévérité** : 🟡 P1 — le calendrier est un écran client visible
> **Owner** : agent Prospection (team ui-polish)
> **Créé** : 2026-05-22
> **Demandeur** : Robert

## Problème

Le calendrier des rendez-vous est **moche en desktop ET en mobile** (constat
Robert). C'est l'onglet "Calendrier" de `/pipeline` —
`src/components/dashboard/appointment-calendar.tsx`, basé sur FullCalendar
(`@fullcalendar/react` + plugins daygrid/timegrid/interaction).

## Demande

Refonte visuelle du calendrier pour qu'il soit propre et cohérent avec le
reste de l'app :

- **Desktop** : mise en page soignée, intégration au design system
  (FullCalendar a un thème par défaut générique — il faut le styler avec
  les tokens OKLCH de l'app : couleurs, radius, typo, états).
- **Mobile** : le calendrier doit être utilisable sur 375px (FullCalendar
  en `dayGridMonth` déborde souvent sur mobile — prévoir une vue liste ou
  `timeGridDay` sous `md`, comme l'accordéon qu'on a fait pour le Kanban).
- Cohérence avec `calendar-dialog.tsx` (la modale de création/édition de
  RDV) et le composant `ui/calendar.tsx` (date-picker shadcn).

## Contraintes

- FullCalendar se style via CSS custom + l'API `eventContent` / classes.
  Ne pas remplacer la lib (elle est déjà lazy-loadée — cf
  `pipeline-view.tsx`, `next/dynamic`).
- Tokens design system, échelle Tailwind, cibles tactiles ≥32px.
- Validation : revue Chrome (team ui-polish) desktop + 375px.

## Référence

Composants : `appointment-calendar.tsx`, `calendar-dialog.tsx`,
`ui/calendar.tsx`, `upcoming-appointments.tsx`. Lazy-load déjà en place
dans `pipeline-view.tsx`.
