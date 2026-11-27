# [PROSPECTION] Poser SEARCH_API_SECRET dédié en prod (actuellement fallback)

> **Sévérité** : 🔵 P3 (amélioration sécu — pas bloquant, l'API marche)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-17

## Contexte

Le moteur de recherche IA (/api/search/*) est en prod depuis 2026-06-17. Son auth
M2M lit `SEARCH_API_SECRET`, avec fallback sur `TENANT_API_SECRET` si absent
(cf src/lib/search/auth.ts).

En prod, `SEARCH_API_SECRET` n'est PAS posé → l'API tourne sur le fallback
`TENANT_API_SECRET`. Fonctionnel et sûr, MAIS : le secret de recherche partage
alors le secret cross-app → pas de rotation indépendante.

## À faire (quand on touchera la config prod de toute façon)

1. Générer : `openssl rand -hex 24`
2. Poser `SEARCH_API_SECRET=...` dans la config ENV prod du compose Prospection
   (le compose n'apparaît pas dans `compose.all` Dokploy — vérifier où vit le
   `.env` prod : container `compose-connect-redundant-firewall-l5fmki-prospection-1`,
   image `ghcr.io/christ-roy/prospection:latest`).
3. Redéployer + re-tester `/api/search/estimate` avec le nouveau token.
4. Le poser AUSSI sur le banc search-dev / staging si on veut un secret cohérent.

## Pourquoi pas maintenant
La prod marche (testé : 201 restaurants 69 sans site). Toucher la config + redéployer
juste pour ça = risque > bénéfice immédiat. À grouper avec une autre modif ENV prod.
