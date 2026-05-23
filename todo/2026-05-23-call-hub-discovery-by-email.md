# [PROSPECTION] Appeler `GET /api/users/by-email` du Hub au login

> **Sévérité** : 🟡 P2 (débloque Discovery cross-app pour Prospection)
> **Owner** : agent Prospection
> **Créé** : 2026-05-23 par agent Hub discovery (déposé en file cross-agent)
> **Repo demandeur** : `veridian-hub` (endpoint posé 2026-05-23 sur staging)

## Contexte

Le Hub expose désormais (livré 2026-05-23 sur staging branch) :

```
GET https://hub.veridian.site/api/users/by-email?email=<urlencoded>
```

Auth HMAC entrant (cf. plus bas). Réponse minimaliste :

```json
{
  "exists": true,
  "tenants": [
    {"app": "notifuse", "role": "owner"},
    {"app": "prospection", "role": "member"}
  ]
}
```

Ou `{"exists": false, "tenants": []}` si l'email est inconnu du Hub.

## Ce qu'on attend côté Prospection

Au login d'un user (par exemple dans le callback `auth.signin` ou avant
de servir la page Login), appeler ce endpoint pour :

1. **Décider du redirect post-login** : si le user a déjà des apps
   actives autres que Prospection, proposer un menu de redirection vers
   le Hub `app.veridian.site` (UX "tu as plusieurs apps, va au Hub").
2. **Pré-charger les liens cross-app** dans le dashboard Prospection
   (cards "Tu as aussi Notifuse — voir le Hub →").
3. **Pas de blocage** : si le Hub répond 5xx ou timeout > 2s, on continue
   le login Prospection normalement (fallback silencieux).

## Contrat HMAC (réutilise les secrets existants)

**Headers à envoyer** :
```
x-veridian-app: prospection
x-veridian-timestamp: <unix_ms>
x-veridian-hub-signature: <hex sha256(secret, "{ts}.{METHOD}.{path}?{query_sorted}")>
```

**Secret côté Prospection** : `HUB_API_SECRET` (même valeur que le
secret HMAC utilisé pour les appels Hub → Prospection — c'est symétrique,
pas de secret en plus à provisionner). Côté Hub la variable s'appelle
`PROSPECTION_HUB_API_SECRET` (déjà set en prod et staging).

**String canonique** : `${timestamp}.GET.${pathname}?${query_sorted_alpha}`
- query params triés alphabétiquement avant URL-encode
- exemple : `1700000000000.GET./api/users/by-email?email=alice%40example.com`

**Cf. `lib/discovery/hmac.ts` côté Hub pour l'implé exacte (16 tests).**

## Codes retour à gérer

| Code | Sens | Action côté Prospection |
|---|---|---|
| 200 | OK | Parser `{exists, tenants}` |
| 400 | Bad request (query mal formée, headers manquants) | Bug côté Prospection, log + skip |
| 401 | HMAC invalide / drift > 5min | Bug d'horloge ou secret désynchro, log + skip |
| 429 | Rate-limit | Backoff (30/min/secret max), skip ce login |
| 503 | Secret pas configuré côté Hub | Bug d'infra côté Hub, log + ouvrir ticket |

**Toujours en best-effort** : un échec ne doit JAMAIS bloquer le login.

## Réf

- Endpoint Hub : `app/api/users/by-email/route.ts`
- Helper HMAC Hub : `lib/discovery/hmac.ts` (string canonique + verify)
- Agrégateur Hub : `lib/discovery/aggregate.ts`
- Tests Hub (44 cas) : `__tests__/api/users/by-email.test.ts`,
  `__tests__/lib/discovery/*.test.ts`
- Ticket Hub source : `veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md`
