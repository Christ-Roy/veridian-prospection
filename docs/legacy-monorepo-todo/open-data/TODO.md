# Open Data — TODO

> Pipeline d'acquisition data pour Prospection.
> Vision et architecture : [VISION.md](./VISION.md)
> Parent : [../TODO.md](../TODO.md)
>
> Derniere mise a jour : 2026-04-13

## Etat actuel

- **Enrichissement API gouv EN COURS** : 2 workers (local + dev server) a 1.5 req/s
  - Champs : dirigeant naissance, etat admin, date fermeture, nb etablissements, convention collective
  - Trie par prospect_score DESC (meilleurs prospects d'abord)
  - ETA : ~90h pour 997K SIRENs
  - Logs : `/tmp/enrich-worker-0.log` (local), `/tmp/enrich-worker-1.log` (dev)

- **web_agency migre** : 33K entreprises avec prestataire identifie (Solocal 11K, Webador 2K, RestoPro 1.3K)

## P0 — Urgences pipeline

- [ ] **Backup DB prod** avant tout enrichissement massif
  - `pg_dump` cron quotidien via Dokploy Schedule Job
  - Retention 7 jours minimum
  - Stocker sur dev server (pas sur le meme disque que la prod)

- [ ] **Migrer les scripts d'enrichissement sur PROD**
  - Le script `enrich-birth-dates.py` tourne en local avec un tunnel SSH — fragile
  - Le mettre en cron Dokploy ou systemd sur le VPS
  - Avantage : acces DB direct, pas de tunnel, pas de rate limit IP partage

## P1 — Enrichissements a lancer

- [ ] **Tresorerie liquide via API INPI**
  - Le champ `tresorerie` existe dans l'API INPI (disponibilites = cash bancaire)
  - 99% de couverture sur les bilans INPI
  - Ajouter colonne `tresorerie` dans `entreprises` + `inpi_history`
  - Script : call API INPI par SIREN, extraire tresorerie du dernier bilan
  - Killer feature : "votre site coute X, c'est Y% de votre tresorerie"

- [ ] **Solocal tier (forfait mensuel)**
  - Data dans scan web (agency_signature + detection Duda)
  - Tiers : Essentiel (~80/mois), Premium (~200), Performance (~220), Privilege (~355)
  - Migrer vers `entreprises.solocal_tier`
  - Argument commercial : "vous payez ~200/mois pour un site Duda basique"

- [ ] **Multi-SIRET par dirigeant**
  - Calculable : GROUP BY dirigeant_nom, dirigeant_prenom HAVING count(*) > 1
  - Ajouter `nb_entreprises_dirigeant` dans entreprises
  - Un gerant multi-boites = prospect a haut potentiel

## P2 — Infrastructure pipeline

- [ ] **Deplacer open-data-hub dans le monorepo**
  - `veridian-platform/open-data/` (gitignore les data/)
  - Les scripts de scraping et d'enrichissement vivent avec le code
  - Le README explique comment lancer un enrichissement

- [ ] **DB prod read-only pour dev**
  - Exposer PG prod sur Tailscale (pg_hba.conf)
  - User read-only `prospection_ro` avec SELECT seulement
  - L'app en dev mode ecrit les visites (outreach.last_visited) — il faut que ca tombe
    en silence ou ecrive dans une DB locale separee

- [ ] **Cron backups prod**
  - Dokploy Schedule Job : pg_dump quotidien
  - Rotation 7 jours
  - Stockage : dev server via SSH (11G libre)

## P3 — Nettoyage legacy

- [ ] Migrer les colonnes utiles de `results` (438K rows) vers `entreprises`
  - agency_signature → FAIT (web_agency)
  - api_dirigeant_annee_naissance → EN COURS (via API directe, plus fiable)
  - Autres colonnes a auditer

- [ ] Supprimer `results` une fois tout migre
- [ ] Supprimer `pj_leads` une fois solocal_tier migre
- [ ] Supprimer `email_verification`, `phone_verification` (legacy)

## Decisions techniques

- **API gouv rate limit reel** : documente a 7 req/s, en pratique 3 req/s par IP semble le max
  sans 429. Avec 2 workers sur 2 IPs differentes, 3 req/s total est stable.
- **API INPI** : rate limit a determiner, probablement similaire
- **DuckDB local** : utile pour l'exploration/prototypage, mais PAS une source de verite.
  Toute data validee doit finir en PG prod.
