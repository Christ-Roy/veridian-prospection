# ODH x402 — distribution agent-first

Cette V1 transforme deux capacités ODH existantes en produits achetables directement par un agent IA, sans compte ni clé API : estimation d'un segment et page bornée d'entreprises avec coordonnées professionnelles publiques.

Le contrat de découverte public est servi par :

- `/.well-known/x402` : manifeste compact ;
- `/.well-known/agent-skills/odh-market-intelligence/SKILL.md` : procédure autonome pour agents ;
- `/api/x402/odh/catalog` : catalogue vivant des champs, opérateurs, prix et limites ;
- `/llms.txt` : orientation minimale pour crawlers et modèles.

Les routes payantes V1 sont uniquement :

- `POST /api/x402/odh/estimate` à 0,003 USD ;
- `POST /api/x402/odh/companies` à 0,01 USD.

Les appels acceptent des filtres structurés, jamais du SQL. Une page contient au maximum 50 entreprises et 20 champs. Les emails, téléphones et domaines professionnels publics sont inclus ; les personnes et dirigeants ne le sont pas dans cette façade.

Les routes payantes lisent la projection ClickHouse ODH `odh.company_search_current`
via HTTP interne Tailscale. PostgreSQL reste réservé à l'auth, au paiement, aux
commandes longues et à l'état opérationnel. Il n'y a pas de fallback PostgreSQL
pour les lectures x402 payantes : une config ClickHouse absente, un timeout ou
une limite de lecture renvoie une erreur explicite et annule le règlement.

Les tables de commandes longues sont préparées dans PostgreSQL, mais aucun job payant asynchrone n'est publié avant qu'un worker et son lien de règlement soient testés.
