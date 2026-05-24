# [PROSPECTION] Fiche historique 360° — Phase 4 : polish (filtres avancés + pagination)

> **Type** : Feature UI + perf — polish timeline
> **Sévérité** : 🟢 P2 — confort utilisateur, pas bloquant commercialisation.
> **Owner** : agent Prospection
> **Créé** : 2026-05-24
> **Suite de** : Phase 1, 2, 3

## Contexte

Une fois Phase 1-3 livrées, la timeline d'un prospect actif peut compter 50-200 events. La pagination devient nécessaire au-delà de 100 events. Cette phase ajoute le polish UI + perf.

## Travaux Phase 4

### Pagination cursor-based

1. Étendre `getProspectTimeline` pour accepter `cursor` (event `occurredAt` du dernier event reçu).
2. Endpoint `/api/leads/[siren]/timeline?cursor=2026-05-20T10:00:00Z` renvoie `{ events, nextCursor? }`.
3. UI `history-tab.tsx` : bouton "Charger plus" en bas qui passe le cursor.
4. Optionnel : infinite scroll IntersectionObserver.

### Filtres avancés

1. Filtre par user (qui a fait l'action) — dropdown des users du workspace.
2. Filtre recherche full-text dans `notes` / `body_preview` (côté client suffit pour <500 events).
3. Filtre date range custom (date picker) au-delà des 3 presets actuels.

### Polish visuel

1. Grouper par jour (séparateurs `Hier` / `Lundi 20 mai`).
2. Empty states personnalisés par filtre (ex : "Pas de mail sur cette période").
3. Skeleton loader au lieu du spinner pendant le fetch.

### Sabotage-test E2E (mega battery)

- Login → fiche prospect → onglet Historique
- Vérifier ≥ 1 event de chaque type seedé
- Drag-and-drop kanban : prospect passe de a_rappeler → site_demo
- Reload timeline → nouvel event `pipeline_transition` apparaît en tête (DELAY < 5s)

### Perf

- Si volume > 500 events sur un prospect, envisager UNION ALL SQL côté query au lieu du merge JS (mesure avant d'agir).

## Estimation

~0.5j à 1j selon ampleur du polish.

## Définition de done

- [ ] Pagination cursor + bouton "Charger plus"
- [ ] Filtres user + date range custom
- [ ] Groupement par jour
- [ ] Sabotage-test E2E mega battery passe
- [ ] Skeleton loader
