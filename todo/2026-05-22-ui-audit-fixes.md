# [PROSPECTION] Fixes UI — ce qui compte (audit T18)

> **MISE À JOUR 2026-05-22** — 2 des 3 priorités LIVRÉES en prod :
> - ✅ #1 Mobile cassé /prospects + /pipeline — fait (vue carte, accordéon Kanban)
> - ⏳ #2 /pipeline charge en 17s — **RESTE À FAIRE** (lazy-load FullCalendar
>   déjà câblé via pipeline-view.tsx, mesurer l'effet, traiter le reste)
> - ✅ #3 /api/status leak — fait (compteurs → /api/admin/stats authed)
> Ce ticket reste ouvert UNIQUEMENT pour #2.


> **Type** : Dette UI/perf
> **Sévérité** : 🟡 P1 (le 80%) → 🔵 backlog (le 20%)
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Source** : audit T18 (rapport `/tmp/ui-audit-2026-05-21.md`)

## Principe 80/20

L'audit T18 a déroulé une checklist WCAG complète. La majorité (a11y
lecteurs d'écran, heading order, skip links) n'a **aucun ROI business**
pour un SaaS de prospection B2B desktop. Ce ticket ne garde que ce qui
impacte de vrais utilisateurs. Le reste est en annexe "si un jour".

---

## 🎯 LE 80% — à faire (impact utilisateur réel)

### 1. Mobile cassé — `/prospects` et `/pipeline`

Un commercial qui ouvre le dashboard sur téléphone voit un truc pété.

- **`/prospects`** : la table fait 1357px de large dans un écran de
  375px → déborde, pas scrollable proprement.
  Fix : wrapper `overflow-x: auto` strict, ou vue carte/liste sous `md`.
- **`/pipeline`** : colonnes Kanban `min-w-[220px]` débordent sur 375px.
  Fix : scroll-snap horizontal, ou accordéon mobile.

Effort : M (moyen). **Priorité 1.**

### 2. `/pipeline` charge en 17,7 secondes

Pire page du dashboard. 1025 KB de JS — probablement Recharts ou la lib
drag-and-drop chargée en entier sans code-split. Personne n'attend 17s.

Fix : `@next/bundle-analyzer`, lazy-load / `dynamic()` les libs lourdes.
Cible bundle base < 300 KB.

Effort : M. **Priorité 2.**

### 3. `/api/status` expose les volumes business en public

`GET /api/status` (sans auth) retourne `entreprises_count: 996657,
outreach_count, workspaces_count`, etc. Donne la taille du business à
n'importe qui. Aussi remonté par le pentest T16.

Fix : `/api/status` garde `{status, db, auth, timestamp}` seulement.
Compteurs → `/api/admin/stats` (auth).

Effort : XS (5 min). **Priorité 3 — quick win.**

---

## Annexe — le 20% (backlog, ROI quasi nul, ne pas prioriser)

À ne traiter que si on touche déjà le fichier concerné, jamais en
chantier dédié :

- `/login` : `autocomplete="email"` + `current-password` (UX
  gestionnaires de mdp) — XS, à faire en passant si on touche le login
- `/login` form sans `method`/`action` fallback JS-down
- Page 404 custom (`src/app/not-found.tsx`)
- Accessibilité lecteurs d'écran (104 checkbox sans `aria-label`,
  heading order WCAG, skip links, boutons icône-only sans label) —
  **pas pertinent** pour un SaaS B2B desktop, pas de contrainte légale.
  Ignoré sciemment.
- Police body 9-11px → 12px
- `meta description` unique par page (dashboard derrière auth = SEO nul)

## Référence

- Rapport complet : `/tmp/ui-audit-2026-05-21.md`
- M5 (`/api/status` leak) aussi dans pentest T16 (finding L1)
