# [PROSPECTION] Endpoint `GET /api/users/by-email` pour Hub discovery

> **Type** : Endpoint contrat HMAC Hub
> **Sévérité** : 🟡 P2
> **Owner** : agent Prospection
> **Spec parent** : `veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md`
> **Créé** : 2026-05-20

Voir spec parent pour le contrat HMAC + format de réponse.

Prospection a déjà un magic_link / autologin Hub via le contrat HMAC actuel,
donc `magic_link_capable: true`.

Implementation : nouvelle route `GET /api/users/by-email` avec verify HMAC
(pattern déjà en place) + query SQL `SELECT workspaces JOIN members WHERE
email = ?`.

## Effort

- 1j

## Référence

- `veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md`
