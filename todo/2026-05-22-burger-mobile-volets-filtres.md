# [PROSPECTION] Menu hamburger mobile — volets déroulants pour TOUS les filtres

> **Type** : UI/UX mobile
> **Sévérité** : 🟡 P1 — l'app n'est pas utilisable sereinement sur mobile
> **Owner** : agent Prospection (team ui-polish)
> **Créé** : 2026-05-22
> **Demandeur** : Robert
> **Constaté de visu** : team-lead via Chrome MCP, /prospects à 375px

## Problème constaté (vérifié dans Chrome, viewport 375px)

Sur `/prospects` en mobile :

1. **Une rangée de filtres déborde** sous le compteur de prospects —
   `Rechercher / Mobile / Géographie / Taille / Qualité / Historique`
   dans un `flex overflow-x-auto` (composant `FilterBar`). Sur 375px
   elle déborde, scroll horizontal pénible, les libellés sont coupés
   (« Mob… »). C'est la « 2e navbar » que Robert juge mal affichée.

2. **Le menu hamburger ne contient QUE 4 liens de nav** (Prospects /
   Pipeline / Historique / Settings) — aucun filtre. Le toggle site
   (livré récemment, commit `c37417c`) y est ajouté mais c'est tout.

3. Les sidebars de filtres (Secteur, Géographie, Taille, Qualité) sont
   `hidden md:block` — donc **invisibles sur mobile**. Résultat : sur
   téléphone, l'utilisateur n'a accès qu'à la `FilterBar` qui déborde.

## Demande

Refondre le menu hamburger mobile pour qu'il contienne **tous les
filtres en volets déroulants** (accordéon), et **supprimer la rangée de
filtres `FilterBar` mal affichée en mobile**.

### Cible

Le burger mobile doit avoir, en plus des liens de nav :
- Recherche
- Volet **Secteur** (la liste de secteurs aujourd'hui dans `SectorSidebar`)
- Volet **Géographie** (`geo-filter-sidebar` / `france-map`)
- Volet **Taille** (`size-filter-sidebar`)
- Volet **Qualité** (`quality-filter-sidebar`)
- Le toggle **site** (déjà présent — le garder)
- Le **mode mobile** / autres toggles de la `FilterBar`

Chaque volet = un `Accordion` (composant Radix déjà dans `src/components/ui/`)
replié par défaut, qu'on déplie pour accéder au filtre.

### Contraintes

- Réutiliser les composants de filtre EXISTANTS (`SectorSidebar`,
  `geo-filter-sidebar`, `size-filter-sidebar`, `quality-filter-sidebar`,
  `quality-tabs`) — ne PAS réécrire la logique de filtrage, juste les
  remonter dans des volets accordéon mobile. Rendu conditionnel : volets
  accordéon < `md`, sidebars classiques ≥ `md`.
- Supprimer / masquer la `FilterBar` débordante en mobile une fois que
  ses fonctions sont dans le burger.
- Composant `Accordion` de `ui/`, tokens design system, échelle Tailwind.
- Cibles tactiles ≥ 32px, zéro débordement horizontal à 375px.
- Validation : revue Chrome (team ui-polish, agent ui-reviewer) à 375px.

## Note

Découle directement du sprint UI mobile 2026-05-22 (4 fixes :
header / accordéon pipeline / vue carte / toggle site). Ce ticket est
la suite logique : on a réparé les écrans, il reste à rendre le
**filtrage** vraiment utilisable sur mobile. À traiter par la prochaine
session de la team ui-polish.
