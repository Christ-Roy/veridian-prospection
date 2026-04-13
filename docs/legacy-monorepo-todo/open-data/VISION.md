# Open Data — Vision

> Pipeline d'acquisition et d'enrichissement des donnees entreprises pour Prospection.
> Ce document decrit l'architecture cible. Lire TODO.md pour l'etat actuel.

## Probleme actuel

Les donnees sont eparpillees :
- DuckDB local (`~/open-data-hub/data/datahub.duckdb`) — 3M scanweb, 6M bilans INPI, 40+ sources
- PostgreSQL local (`veridian-datahub` container, port 5432) — 17 bases source, vide ou partiel
- Table legacy `results` en prod (438K rows) — ancien pipeline, colonnes pas migrées
- Table `inpi_history` en prod (3.5M rows) — bilans sans tresorerie
- JSONL brut (`~/open-data-hub/data/sources/inpi/dirigeants/`) — 1165 SIRENs enrichis API INPI
- Scripts one-shot dans `~/open-data-hub/` et `~/scraping-dor-fr-script/`

Aucun pipeline reproductible. Chaque enrichissement est fait a la main, une fois, sans backup.

## Architecture cible

```
Sources Open Data (API gouv, INPI, BODACC, SIRENE, scan web...)
        |
        v
  [Scripts d'acquisition]     ← tournent sur PROD (cron Dokploy)
  Collecte brute dans PG      ← bases source_* dans datahub PG
        |
        v
  [Pipeline d'enrichissement] ← calcul scores, merge, dedup
  Ecrit dans `entreprises`    ← table prod, seule source de verite
        |
        v
  [Backup automatique]        ← pg_dump quotidien, retention 7j
        |
        v
  App Prospection (lecture)   ← Next.js lit `entreprises` + `inpi_history`
```

## Principes

1. **`entreprises` est la seule source de verite.** Toute data enrichie finit dans cette table.
   Pas de table intermediaire, pas de DuckDB a cote, pas de JSONL.

2. **Les scripts tournent sur PROD.** Pas en local. La prod a l'acces DB direct,
   les backups, et la persistence. Un script en local = data perdue au prochain reboot.

3. **Backups avant chaque enrichissement.** `pg_dump` avant, script apres.
   Si le script casse la data, rollback en 2 minutes.

4. **Enrichissement idempotent.** Chaque script peut etre relance sans casser.
   Utiliser `ON CONFLICT DO UPDATE` ou `WHERE col IS NULL` pour ne pas re-traiter.

5. **Rate limits respectes.** API gouv = 7 req/s, INPI = a determiner.
   Un worker par source, avec backoff exponentiel sur 429.

6. **Pas de travail dans le vent.** Si une data a de la valeur, elle est en prod et backupee.
   Sinon elle n'existe pas.

## Sources de data identifiees

| Source | API/Fichier | Donnees | Couverture | En prod ? |
|--------|------------|---------|-----------|-----------|
| API recherche-entreprises | REST, 7 req/s, gratuit | Dirigeant (nom, naissance), etat admin, nb etablissements, convention collective | 100% personnes physiques | EN COURS (script enrichissement) |
| INPI bilans (via API) | REST, rate limit ? | Tresorerie liquide, total dettes, capital social | ~70% des entreprises | NON — a ajouter |
| INPI bilans (parse PDF) | Fichiers locaux | CA, resultat, EBE, charges, actif — historique 5-10 ans | 65% via inpi_history | OUI (3.5M rows) |
| Scan web (scraping maison) | Scripts Python | CMS, HTTPS, responsive, copyright, agency_signature | ~50% (3M scans) | PARTIEL (web_* cols) |
| BODACC | API OpenDataSoft | Liquidations, redressements, sauvegardes | quasi-exhaustif | OUI (bodacc_status) |
| SIRENE | Fichier stock INSEE | SIREN, denomination, NAF, effectifs, creation | 100% | OUI (base) |
| Pages Jaunes | Scraping | Activites, avis, solocal tier | ~50K leads PJ | PARTIEL (pj_leads legacy) |

## Data manquante a haute valeur

1. **Tresorerie liquide** — disponible via API INPI, pas encore importee
2. **Solocal tier** (forfait mensuel du client) — detecte par scan web, pas migre vers entreprises
3. **Age dirigeant** — EN COURS d'enrichissement via API gouv
4. **Multi-SIRET par dirigeant** — calculable depuis les donnees existantes
5. **Agency signature nettoyee** — FAIT (web_agency, 33K leads)
