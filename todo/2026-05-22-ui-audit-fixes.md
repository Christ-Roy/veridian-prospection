# [PROSPECTION] Fixes UI/UX — issues audit T18

> **Type** : Dette UI/UX/a11y/perf
> **Sévérité** : 🟡 P1 (2 CRITICAL mobile) → 🟢 P3 (cosmétique)
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Source** : audit T18 sprint v1.5 (rapport `/tmp/ui-audit-2026-05-21.md`)

## Contexte

Audit UI complet du dashboard Prospection staging via Chrome MCP
(2026-05-21). Pages : /login, /prospects, /pipeline, /historique,
/settings, /admin, /404. Le sprint v1.5 était 100% backend — l'UI n'a
pas bougé. Ce ticket regroupe la dette UI identifiée, à traiter en
sprint dédié.

## 🔴 CRITICAL — Mobile cassé (à fixer en priorité)

### C1 — `/prospects` : table overflow mobile

`<table class="w-full caption-bottom text-sm">` mesure 1357px de large
dans un `<main>` de 375px en mobile. Le contenu déborde, pas scrollable
proprement.

**Fix** : soit wrapper la table dans `overflow-x: auto` strict, soit
transformer en vue card/liste sous le breakpoint `md`.

### C2 — `/pipeline` : colonnes Kanban overflow mobile

`<div class="flex flex-col min-w-[220px] ...">` → 228px sur écran 375px.
Le board Kanban déborde horizontalement.

**Fix** : scroll-snap horizontal OU collapse colonnes en accordéon mobile.

## 🔴 HIGH

### H1 — `/login` : autocomplete manquant

Les `<input>` email/password n'ont pas d'attribut `autocomplete`. Casse
l'UX des gestionnaires de mots de passe.

**Fix** : `autocomplete="email"` sur email, `autocomplete="current-password"`
sur password. Effort : XS (2 lignes).

### H2 — `/pipeline` : perf catastrophique

`loadEventEnd: 17720ms` (pire page du dashboard), 1025 KB de JS.
Probablement Recharts ou lib drag-and-drop chargée full sans code-split.

**Fix** : audit bundle (`@next/bundle-analyzer`), lazy-load les libs
lourdes (drag-and-drop, charts), dynamic import. Cible bundle base < 300 KB.

## 🟡 MEDIUM — a11y + exposition

### M1 — Heading order WCAG 1.3.1 (toutes pages dashboard)

Le Command Palette (caché) émet un `<h2>` AVANT le `<h1>` de la page.
Violation WCAG 1.3.1 — lecteurs d'écran perdus.

**Fix** : wrapper le Command Palette dans `<div role="dialog" aria-label="...">`
sans `<h2>` racine, ou utiliser un heading masqué cohérent.

### M2 — `/prospects` : 104 checkbox sans aria-label

Les Radix `Checkbox` de sélection de ligne (colonne 1) n'ont pas de label.

**Fix** : `aria-label="Sélectionner {nom_entreprise}"` injecté dynamiquement.

### M3 — Boutons icône-only sans aria-label

~14 boutons icône-only répartis sur /prospects (7), /pipeline (2),
/historique (2), /settings (3) sans `aria-label`.

**Fix** : ajouter `aria-label` descriptif à chacun.

### M4 — `/settings` : 5 sections H2 à plat

5 sections en `<h2>` sans hiérarchie `<h3>` — groupes implicites confus
pour lecteurs d'écran.

**Fix** : structurer H2 + items H3, ou utiliser `role="tablist"`.

### M5 — `/api/status` expose des volumes opérationnels

`GET /api/status` public retourne `entreprises_count: 996657,
outreach_count, followups_count, claude_activity_count, workspaces_count`.
Info exploitable par un attaquant (taille du business).

**Fix** : `/api/status` garde uniquement `{status, db, auth, timestamp}`.
Déplacer les compteurs vers `/api/admin/stats` (auth required).
NB : aussi remonté par pentest T16 (L1).

### M6 — `/404` : pas de page personnalisée

Une route inexistante affiche le layout standard avec H1 "Prospection",
pas de message "Page introuvable" ni lien retour.

**Fix** : créer `src/app/not-found.tsx`.

## 🟢 LOW — cosmétique

- L1 — `meta[name=description]` identique sur toutes pages dashboard →
  description unique par section (SEO, même si dashboard derrière auth)
- L2 — Police body 9-11px sur 84 nœuds → min 12px pour body text (WCAG)
- L3 — Pas de skip link (`<a href="#main">Aller au contenu</a>`)
- L4 — Pas de page de loading states visibles (skeleton/spinner) sur
  navigation /prospects — à vérifier (peut être rendu trop vite)
- L5 — `/login` form sans `method`/`action` fallback (JS-only) — ajouter
  `method="POST"` pour dégradation gracieuse

## 🔵 INFO — observations (pas d'action requise)

- Pas de dark mode (décision produit)
- UI fr-only (OK, mono-locale assumée)
- `/admin` non audité visuellement (cache contexte 30s a bloqué le user
  de test) — à ré-auditer avec un vrai compte admin si besoin

## Synthèse perf (référence)

| Page | loadEvent | JS KB |
|---|---:|---:|
| /login | 9197ms | 505 |
| /prospects | 9197ms | 985 |
| /pipeline | **17720ms** | **1025** |
| /historique | 5796ms | 750 |
| /settings | 1270ms | 551 |

Cible : bundle base < 300 KB. /pipeline et /prospects à dégraisser.

## Ordre de traitement recommandé

1. **C1 + C2** (mobile cassé) — impact utilisateur direct
2. **H1** (autocomplete) — XS, quick win
3. **M5** (status leak) — sécu, quick win
4. **H2** (perf pipeline) — gros chantier, mérite un sprint
5. **M1-M4, M6** (a11y) — batch a11y
6. **L1-L5** (cosmétique) — au fil de l'eau

## Référence

- Rapport complet : `/tmp/ui-audit-2026-05-21.md` (volatil — copier si besoin)
- Audit réalisé par agent T18 (sprint v1.5)
