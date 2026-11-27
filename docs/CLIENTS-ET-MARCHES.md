# Clients, rapports, API par marché, pages publiques (25/11/2026, VISION-ATLAS R1 et R2)

- **Clients** (`src/atlas/clients.ts`, table `atlas_clients`) : SIREN ou SIRET, clé de contrôle vérifiée, 20 000 par espace, le numéro seul.
  Écran « Mes clients » (CSV, collage), outils `importer_clients`, `retirer_clients`, `clients_resume`.
- **Pénétration** (`penetration_marche`) : clients actifs du marché sur entreprises actives du marché. Seules comptent les conditions que le cube ET
  la base maître savent lire (NAF, division, département, forme, effectif, création) ; le reste est rendu dans `conditions_ignorees`.
- **Filtre « Est déjà client »** : la liste vient de l'espace de l'appel (`clients-portee.ts`, AsyncLocalStorage), jamais du filtre. Hors d'un
  espace, il se refuse. Paramètres de 5 000 numéros (ClickHouse refuse un champ de plus de 128 Ko). Jamais une colonne.
- **Ventes** (`src/atlas/ventes.ts`, table `atlas_ventes`) : montant, date, référence, rattachés au SIREN ; `importer_ventes`, `retirer_ventes`. La même
  référence remplace, jamais ne double ; sans référence, une vente se reconnaît à son contenu. Vendre fait un client ; retirer le client retire ses
  ventes. Écran : le même fichier CSV, dès qu'une colonne dit montant, total, vente, HT ou TTC (« CA » n'en est pas une).
- **Règles proposées** (`proposer_priorite`) : ce qui pèse plus dans les ventes, ou chez les clients s'il n'y en a pas, que dans le segment (10 clients au
  moins, 2 écarts types). Par montant : les très gros sont plafonnés au 95e centile et la taille d'échantillon est celle de Kish.
- **Un même mot, un même nombre** : « nom contient » se cherche par les mots entiers de la base maître (enseigne comprise), au marché comme à la cible.
- **Tournée** (`tournee_maps`, `parcours.ts`) : des liens Google Maps, aucune clé, aucun appel à Google, aucun coût.
- **Rapport PDF** (`/api/atlas/rapport`, outil `creer_rapport`) : écrit à la main (`pdf.ts`), que des comptes, tous les plans. Le texte est gardé,
  les chiffres se relisent.
- **API par marché** : `GET /api/v1/marches[/{marche}[/repartition|/entreprises]]`, `openapi.json` par espace, clé `atl_`. Jamais une coordonnée.
- **Pages publiques** : `/marches`, `/marche/{naf}`. Que des comptes du cube, une page par code NAF, gardées 24 h. Non indexées tant que
  `ATLAS_PUBLIC_INDEX=1` posé le 27/11 (parente) : pages indexables, `robots.txt` et `sitemap.xml` ouverts.

## Brancher un ERP (vision du 15/11, état au 25/11)

Ce qui marche aujourd'hui, sans développement chez nous, avec une clé `atl_` (accès avancé de l'espace, accordé par un administrateur) :

1. l'ERP pousse chaque facture (rejouer ne crée rien, la même référence corrige ; un avoir est un montant négatif) :
   `POST /api/atlas/importer_ventes` `{"ventes": [{"numero": "55203253400646", "montant": 1200.5, "date": "2026-03-05", "reference": "F2026-0042"}]}`
   (5 000 par appel, 200 000 en tout). Sans montants, ses clients seuls : `importer_clients` `{"numeros": [...]}` ; un client perdu : `retirer_clients` ;
2. il lit sa part de chaque marché : `GET /api/v1/marches/{marche}` (`penetration.taux_pct`), les entreprises par `/entreprises`, sans coordonnée ;
3. `GET /api/v1/marches/openapi.json` décrit les routes de l'espace, pour générer un client.

Épreuve : `prospection-banc-ecran/banc-api.mjs` (build de production, HTTP réel, 24 contrôles). Pas fait : aucun connecteur propre à un ERP
(Dolibarr d'ASD est la seule instance, jamais mesurée, plan INTEGRATIONS-NATIVES : CRM vers ERP), ni SDK. La recette par clé suffit à ce jour (parente, 25/11).
