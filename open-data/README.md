# Open Data — Pipeline d'enrichissement Prospection

Scripts d'acquisition et d'enrichissement des donnees entreprises.
Les fichiers data (*.duckdb, *.parquet, *.csv) sont gitignores — ils vivent sur les serveurs.

## Structure

```
open-data/
├── scripts/          # Scripts Python d'enrichissement (committes)
│   ├── enrich-api-gouv.py     # Enrichissement via API recherche-entreprises
│   └── ...
├── data/             # Donnees locales (gitignore)
├── .gitignore
└── README.md
```

## Voir aussi

- `todo/apps/prospection/open-data/TODO.md` — etat des enrichissements
- `todo/apps/prospection/open-data/VISION.md` — architecture cible du pipeline
- `~/open-data-hub/` — ancienne base DuckDB (a migrer ici a terme)
