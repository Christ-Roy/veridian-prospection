# Plan technique Atlas (09/11/2026)

Vision : `CLAUDE.md`, section « Vision produit ». Maquette : `docs/maquette/atlas-des-marches.html`.

## Décisions

| Sujet | Décision | Pourquoi |
|---|---|---|
| Point de départ | Produit neuf dans ce dépôt ; l'ancienne app est taguée `archive/prospection-v1-20261109` et ses écrans restent servis jusqu'à la bascule | identité Hub, MCP, déploiement canari, pg-saas et tests sont en prod et éprouvés : on ne réécrit pas la tuyauterie |
| Données marché | ClickHouse ODH, vue `odh.company_prospection_current` (2,15 M entreprises publiées, 151 colonnes), en lecture seule | une seule source (ROB-173), déjà dédoublonnée, scorée, géocodée |
| Données de l'app | pg-saas, base `prospection` : dossiers, segments, versions, moteurs de score, exports | ce que l'utilisateur crée lui appartient et se versionne |
| Requêtes | Un segment est un filtre JSON validé (zod), traduit en SQL ClickHouse paramétré par un compilateur à liste blanche de champs. Jamais de SQL fourni par l'IA ou l'utilisateur | injection impossible, coût borné |
| Code | `src/atlas/` (domaine), `src/app/atlas/` (écrans), outils MCP ajoutés au catalogue existant | séparé de l'ancien code, qui partira à la bascule |

## Mesures sur ODH (09/11, compte odh_ro, SQL du compilateur)

- `company_prospection_current` = 2 161 852 entreprises « prospectables » (contacts, web, scores), pas tout le
  marché : 30 M de SIREN existent. Requêtes du compilateur : 0,1 à 0,25 s sur la vue entière.
- `priority_score_v2` renseigné pour 205 743 entreprises seulement ; `email_verification = 'existe'` rare.
- Exemple : NAF 4322A dans le Rhône = 568, dont 497 non bloquées, 164 sans site (155 non bloquées).
- Conséquence : deux sources à proposer, « prospectables » (enrichie) et « marché complet » (30 M, moins de
  colonnes) pour l'analyse de marché. Les entreprises bloquées (contact absent, ambigu…) restent visibles sur
  demande (`inclure_bloques`).
- Marché complet (accord ODH 09/11) : pas de lecture des 30 M lignes par l'app. ODH publiera un cube agrégé
  `odh.market_cube_current` (comptes par NAF × département × tranche d'effectif × année de création × actif/fermé,
  recalculé à chaque release) ; le détail d'une case vient de `odh.search_company` (1 ligne par SIREN). Quand la
  phase démarre : envoyer à la session ODH la liste exacte des axes et mesures, elle étend prospection_ro au cube.

## Modèle (pg-saas)

- `atlas_dossiers` : arbre (parent_id), nom, tenant.
- `atlas_segments` : dossier, nom, parent_segment_id (un enfant hérite des filtres du parent et les restreint).
- `atlas_segment_versions` : filtres JSON, auteur (humain ou IA, client OAuth), note ; la dernière version fait foi, toutes se restaurent.
- `atlas_scorings` : par segment, critères pondérés JSON versionnés de la même façon.
- `atlas_exports` : qui, quand, segment et version, nombre de lignes (plans payants seulement).

Combinaisons : union, intersection, exclusion de segments, compilées en une seule requête.

## Filtres (liste blanche)

Métier (`naf_code`, `naf_division`, `activity_sector`), géographie (`department`, `postal_code`, `commune_insee`),
taille (`size_band`, `headcount_range`), finances (`revenue`, `revenue_trend`), web (`primary_domain` présent,
`web_tier`, `website_obsolete`, `is_ecommerce`, `cms`), contact (`deliverable`, `email_verification`, `phone`),
signaux (`creation_date`, `label_rge`, `label_qualiopi`, `public_contracts_count`, `pub_permits_3y_count`),
priorité (`priority_score_v2`, `lead_grade`). Les entreprises bloquées (`blocking_reasons`) sont exclues par défaut.

## Scoring

Score 0-100 = somme pondérée de critères bornés (présence, seuil, plage, liste), calculée côté ClickHouse.
L'IA propose une version (MCP `proposer_scoring`), compare deux versions sur l'échantillon, Robert garde la meilleure.
Plus tard : apprentissage sur les conversions remontées de Twenty.

## MCP (outils ajoutés)

`lister_dossiers`, `creer_segment`, `modifier_segment` (nouvelle version), `compter_segment`, `apercu_segment`
(échantillon paginé), `repartition_segment` (par département, NAF, taille : base des vues carte et diagrammes),
`combiner_segments`, `definir_scoring`, `classer_segment` (top N scoré), `historique_segment`, `restaurer_version`.
Export : jamais par le MCP sans clic humain.

## Cas d'usage zéro : éleveurs de France pour ASD (Henri), 09/11

Rapport fait à la main le 09/11 (réf. ASD-ELEV-2026-11-09) : 346 420 éleveurs actifs (NAF 01.41Z à 01.50Z),
6 710 avec email, 772 contactés, 7 035 prêts, 33 réponses, par type d'élevage et par département.
Atlas doit le reproduire puis le dépasser, et Henri l'utiliser lui-même :
- dossier « Éleveurs », un segment enfant par type d'élevage, vue carte par département ;
- mesures marché et joignabilité depuis le cube ODH (axes envoyés à ODH le 09/11) ; validation croisée sur les
  chiffres du rapport ;
- « contactés / prêts / réponses » : couche par tenant depuis les campagnes Notifuse de l'espace ;
- export Excel réservé au plan payant, tracé, déclenché par un clic ; l'agent peut préparer le fichier.

## Phases

1. Socle : compilateur de filtres + tests, modèle pg-saas, outils MCP de lecture et de segment. **En cours.**
2. Écrans Atlas : rail des dossiers, carte réelle (`france-map-data.ts`), répartition, tableau, fiche, historique.
3. Scoring et comparaison de versions ; combinaisons de segments.
4. Export Excel payant (préparé par l'agent, téléchargé par clic) ; cube de marché ODH ; couche Notifuse par tenant ;
   modules de données par l'IA (catalogue de visualisations).
5. Bascule : Atlas devient la page d'accueil, l'ancien code est retiré.

## Dépendance externe

Un compte ClickHouse `prospection_ro` (lecture seule, vues `*_current` utiles, quotas de requête) et le réseau
ovh-prod → rise:28123. Demandé à la parente le 09/11. En attendant : développement sur source simulée et tests.
