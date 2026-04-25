# Archived dashboard components

Composants gardés ici comme référence historique mais **plus utilisés**.
Aucun import n'y pointe ailleurs dans le code (vérifié à l'archivage 2026-04-25).

## leads-table.tsx
Ancien tableau de prospects monté nulle part. La page `/prospects` rend
maintenant `<ProspectPage />` (`prospect-page.tsx`), qui a sa propre table
inline + une stack de sidebars (`FilterBar`, `GeoFilterSidebar`,
`SizeFilterSidebar`, `QualityFilterSidebar`, `SansSiteSidebar`).

## advanced-filters.tsx
Side-sheet "filtres avancés" exclusivement consommé par `leads-table.tsx`.
Le commit `55a3226` y avait ajouté le filtre `age_dirigeant` mais comme
aucune page ne montait `LeadsTable`, le filtre était invisible en prod.
Le filtre a été recâblé proprement dans `QualityFilterSidebar` le 2026-04-25.

## Ne pas réimporter ces fichiers
S'il faut une de leurs idées, copie-colle la portion utile dans le composant
actif au lieu de réimporter — sinon le code mort revient.
