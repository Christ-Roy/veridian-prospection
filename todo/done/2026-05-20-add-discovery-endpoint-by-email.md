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

## Livraison — 2026-05-20 (agent Prospection)

✅ **Livré en prod** au commit `0fa56c7` (promu `4570fc6 → 0fa56c7`).

### Endpoint disponible

```
GET https://prospection.app.veridian.site/api/users/by-email?email=<email>
```

**Headers requis** (contrat §6.1) :
```
X-Veridian-Timestamp: <unix_ms>
X-Veridian-Hub-Signature: <hex(hmac_sha256(secret, "${ts}." ))>
```

> ⚠️ Pour GET le `rawBody` signé est la chaîne vide. Le Hub doit signer
> exactement `${timestamp}.` (timestamp + point + body vide). Sinon
> `401 Invalid signature`.

### Smoke prod live validé

| Cas | Réponse |
|---|---|
| Sans HMAC | 401 `{error: "Unauthorized"}` |
| Email manquant | 400 `{error: "missing_email"}` |
| Email mal formé | 400 `{error: "invalid_email"}` |
| Ghost user | 200 `{found: false}` |
| Real user Robert | 200 `{found: true, user_email, workspaces: [...]}` |

### Shape réponse 200 found=true

```json
{
  "found": true,
  "user_email": "brunon5robert@gmail.com",
  "workspaces": [
    {
      "workspace_id": "408fc331-...",
      "workspace_name": "brunon5robert's Workspace",
      "role": "admin",
      "plan": "freemium",
      "magic_link_capable": true,
      "fallback_url": "https://prospection.app.veridian.site/login"
    }
  ]
}
```

### Sécu et performance

- HMAC anti-replay drift 5 min
- Validation email RFC 5321 (regex + 254 chars max)
- Normalisation `lowercase + trim` avant lookup (cache Hub côté `email_hash`)
- Soft-delete user/workspace/tenant filtrés
- Tenant suspended (Stripe past_due) → workspace caché
- PII minimization : user_id Prospection et tenant_id pas exposés au Hub
- 3 queries Prisma au total (user + memberships + tenants batch via `IN`)
- Idempotent + cacheable côté Hub (TTL 5 min recommandé)

### Tests

`__tests__/api/users/by-email.test.ts` : **14 cas** couvrant auth, validation,
lookup, shape, anti-bypass, PII. Vitest full suite : 534/534 vert.

### Côté Hub à câbler

L'agent Hub doit maintenant ajouter `prospectionClient.findUserByEmail(email)`
dans son `lib/hub/discoverUserApps.ts` (cf
`veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md` §"Service
`lib/hub/discoverUserApps.ts`").

Le secret HMAC est `PROSPECTION_HUB_API_SECRET` côté Hub (déjà câblé pour
le `regenerate-login` HMAC actuel). Tant que `ACCEPT_LEGACY_BEARER=1`,
l'ancien `Authorization: Bearer` fonctionne aussi en fallback (sera retiré
post observation 7j cf ticket Phase 1 suite).
