# [PROSPECTION] Ré-enrichissement périodique + déclaration propre des tables `staging_*`

> **Type** : Dette de schéma + pipeline data
> **Sévérité** : 🔵 P5 — pas urgent, à planifier quand la fraîcheur data devient un enjeu
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Décision Robert (2026-05-22)** : on GARDE les tables `staging_*`, on ne
> drop rien. À terme on aura besoin de ré-enrichir pour garder la data à jour.

## Contexte — diagnostic DB prod 2026-05-22

Audit de la base `prospection` prod (container `code-prospection-saas-db-1`,
base `prospection`, **2,4 GB** — taille saine, aucune urgence) :

| Bloc | Tables | Poids |
|---|---|---|
| Métier vivant | `entreprises` 997K · `inpi_history` 3.5M · `results` 438K | ~2,05 GB |
| Scraping brut | `staging_master_enrich` 996K · `staging_sirene_src` 996K · `staging_ca_trust` 547K · `staging_bodacc` 9.5K | ~370 MB |
| Legacy vide | call_log, pj_leads, outreach_emails, magic_links, mfa_codes, verification_tokens… | ~0,3 MB |

⚠️ **Correction du ticket Sprint-E** : il annonçait « économie 5-10 GB » en
droppant les `staging_*`. **Faux** — elles pèsent 370 MB, pas 5-10 GB.
L'estimation avait été faite sans regarder la DB. Le ménage des tables vides
ne libère rien non plus (0,3 MB). **Aucun sujet de poids disque ici.**

Autre point : la base `prospection_before_enrich` (641 MB) est un backup
pré-enrichissement laissé monté. Décision Robert : **garder pour l'instant**.
Si un jour besoin de place, c'est le premier candidat (dump R2 + DROP DATABASE).

## Ce que ce ticket couvre

### 1. Déclarer proprement les tables data dans Prisma

Les tables suivantes existent en DB prod mais ne sont **pas déclarées** dans
`prisma/schema.prisma` → accès uniquement en `$queryRaw`, aucun typing,
drift Prisma silencieux :

- `staging_master_enrich`, `staging_sirene_src`, `staging_ca_trust`,
  `staging_bodacc` (tables de travail enrichissement)
- `inpi_history` (3.5M rows — bilans INPI)
- `results` (438K rows — **PROD ACTIVE**, utilisée en `$queryRaw`)
- `segment_catalog` (31 rows — **PROD ACTIVE**)

Action : `npx prisma db pull` pour les introspecter, valider/ajuster le
schéma, vérifier que le code TypeScript existant (`grep -rn "results\|segment_catalog\|staging_" src/`)
s'aligne. Tier 🟡 MOYEN (additif au schema, pas de DDL destructif).

### 2. Ré-armer le pipeline d'enrichissement périodique

À terme, la table `entreprises` doit être rafraîchie (données SIRENE / INPI
qui vieillissent). Les `staging_*` sont la matière première de ce pipeline.

À spécifier le moment venu :
- Quel job alimente les `staging_*` aujourd'hui (cron dev-pub ? container
  scraping ? one-shot manuel ?) — à investiguer, l'historique n'est pas clair.
- Cadence de ré-enrichissement souhaitée (trimestriel ? semestriel ?).
- Où tourne le job (dev-pub, pas en prod — le scraping ne doit pas charger
  le VPS prod).
- Comment le delta `staging_* → entreprises` est appliqué sans downtime.

## Pas urgent

Rien ici ne bloque la prod. La data actuelle reste exploitable telle quelle.
Ce ticket est un P5 : à dégainer quand la fraîcheur des données entreprises
devient un argument commercial ou quand un client le réclame.
