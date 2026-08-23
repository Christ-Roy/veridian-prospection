# Recette x402 ODH

## Ordre de preuve

1. Déployer sur le clone complet de staging avec `X402_ENABLED=1`, Base Sepolia et une adresse publique de réception.
2. Vérifier que `search-dev` reçoit `ODH_CLICKHOUSE_URL`, `ODH_CLICKHOUSE_USER`,
   `ODH_CLICKHOUSE_PASSWORD`, `ODH_CLICKHOUSE_DATABASE=odh` et
   `ODH_CLICKHOUSE_SEARCH_TABLE=company_search_current`.
3. Vérifier le catalogue et le skill comme le ferait un agent sans connaissance du dépôt.
4. Appeler chaque route payante sans paiement : attendre `402` et `PAYMENT-REQUIRED`, sans accès PostgreSQL ni ClickHouse métier.
5. Décoder les exigences et contrôler méthode, chemin, prix, réseau et adresse de réception.
6. Effectuer un paiement Base Sepolia avec un client x402 officiel, puis vérifier le JSON métier et `PAYMENT-RESPONSE`.
7. Vérifier l'idempotence/rejeu et la limitation avant paiement.
8. Ne déclarer Bazaar indexé qu'après confirmation de la ressource exacte dans la discovery publique.

## Critères agent-first

- Un agent partant seulement de `/.well-known/x402` doit trouver le skill, le catalogue et les deux routes.
- Le catalogue doit correspondre au code, notamment `page_size_max=50` et les opérateurs `exists` pour `email`/`phone`.
- Les exemples du skill doivent passer la validation Zod sans adaptation humaine.
- Une route inexistante ou future ne doit pas être annoncée.
- Aucun secret wallet n'est demandé ou journalisé par Prospection.
- Les lectures métier post-paiement viennent de ClickHouse ODH. Si ClickHouse
  n'est pas configuré ou dépasse ses bornes, la route échoue fermé et ne revient
  pas à PostgreSQL.

## Promotion

La production reste `X402_ENABLED=0` tant que le paiement testnet n'est pas prouvé. Base mainnet et Bazaar public sont une promotion séparée, avec prix et facilitateur explicitement configurés.
