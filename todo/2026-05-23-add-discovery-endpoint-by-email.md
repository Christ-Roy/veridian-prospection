# [Prospection] Endpoint `GET /api/users/by-email` pour Hub discovery

> **Type** : Endpoint contrat HMAC Hub
> **Sévérité** : 🔴 P1 — débloque Niveau 1 du tenant sync Hub
> **Owner** : agent Prospection
> **Spec parent** : `veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md`
> **Stratégie sync** : `veridian-hub/todo/2026-05-20-tenant-sync-strategy.md` (Niveau 1)
> **Créé** : 2026-05-23

## Contexte

Hub a livré le service `lib/sync/discovery.ts` qui interroge les apps
downstream en parallèle pour rebuild la liste des cards dashboard sans
dépendre du snapshot dénormalisé `hub_app.tenants`.

Tant que Prospection ne livre pas `GET /api/users/by-email`, la réponse
côté Hub sera `{ found: false }` pour Prospection → la carte n'est pas
affichée (dégradation gracieuse, pas de cassure).

## Endpoint à livrer

### `GET /api/users/by-email?email=<email>`

**Auth** : HMAC standard Veridian (cf `CONTRAT-HUB.md` §3 Pattern A)
- Headers `X-Veridian-Timestamp` + `X-Veridian-Hub-Signature`
- Signature : `hmac_sha256(secret, "${ts}.")` pour un GET (body vide)
- Secret : `PROSPECTION_HUB_API_SECRET` (alias legacy : `PROSPECTION_TENANT_API_SECRET`)
- Anti-replay 5 min, `timingSafeEqual`

**Response 200** (user trouvé) :
```json
{
  "found": true,
  "user_email": "user@x.com",
  "workspaces": [
    {
      "workspace_id": "uuid-prosp",
      "workspace_name": "Prospection X",
      "role": "owner",
      "plan": "freemium",
      "status": "active",
      "magic_link_capable": true,
      "fallback_url": "https://prospection.veridian.site/login"
    }
  ]
}
```

**Response 404** : `{ "found": false }`
**Response 401** : HMAC invalide ou timestamp drift > 5 min

## Tests obligatoires

- Happy 200 (1 workspace, multi-workspace si Prospection est multi-tenant
  côté user — sinon 1 seul)
- 404 (user inconnu)
- 401 (signature invalide, timestamp drift, secret manquant côté serveur)
- 400 (email manquant ou mal formé)

## Référence

- Stratégie sync : `veridian-hub/todo/2026-05-20-tenant-sync-strategy.md`
- Pattern parent : `veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md`
- Contrat HMAC : `veridian-hub/docs/CONTRAT-HUB.md` §3
- Conformité actuelle : `CONTRAT-HUB.md` §10.1 row 22 (0/4)
