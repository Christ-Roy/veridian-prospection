# Hub contract — implémentation côté Prospection

> Source de vérité absolue : `../../CONTRAT-HUB.md` (racine `veridian-platform/`).
> Ce document décrit **comment Prospection implémente** ses obligations contractuelles.
> Maintenu en parallèle de l'avancement du ticket `todo/2026-05-19-hub-contract-conformity.md`.

## §6.1 — Authentification HMAC Hub

### Format canonique (cible long terme)

Headers attendus côté Prospection :

```
X-Veridian-Timestamp: <unix_ms>
X-Veridian-Hub-Signature: <hex(hmac_sha256(secret, "${timestamp}.${raw_body}"))>
Content-Type: application/json
```

Le secret partagé est `HUB_API_SECRET` (env var côté Prospection). Côté Hub, il
porte le nom `PROSPECTION_HUB_API_SECRET` (cf §6.5 du contrat).

Vérification côté Prospection (`src/lib/hub/hmac.ts:verifyHubHmac`) :

1. Drift timestamp < 5min (`HUB_TIMESTAMP_DRIFT_MS`)
2. Recompute `hmac_sha256(secret, ts + "." + rawBody)`
3. Comparaison **temps constant** (`crypto.timingSafeEqual`)

### Curl reproductible (smoke staging)

```bash
SECRET="$HUB_API_SECRET"             # le secret partagé
HOST="https://prospection.staging.veridian.site"
TS=$(date +%s%3N)                     # unix ms
BODY='{"email":"smoke@yopmail.com","plan":"freemium"}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

curl -sSf -X POST "$HOST/api/tenants/provision" \
  -H "Content-Type: application/json" \
  -H "X-Veridian-Timestamp: $TS" \
  -H "X-Veridian-Hub-Signature: $SIG" \
  -d "$BODY" | jq .
```

Doit retourner 200 + `tenant_id`, `api_key`, `login_url`, `plan`, `created: true`.

### Compatibilité legacy (fenêtre de migration)

Pendant la migration coordonnée avec l'agent Hub, on accepte 2 formats supplémentaires :

| Mode | Activé par | Format |
|---|---|---|
| `legacy_email_ts` | `ACCEPT_LEGACY_HMAC=1` (default) | `{ timestamp, signature: hmac(secret, "${email}:${ts}") }` dans le body |
| `legacy_bearer` | `ACCEPT_LEGACY_BEARER=1` (default) | `Authorization: Bearer <secret>` (utilisé par Hub aujourd'hui) |

**Plan de coupure** : 30 jours après que l'agent Hub aura migré son client `prospection` vers le format standard. Coupure = poser les 2 flags à `0` dans Dokploy env vars.

### Sécurité

- `verifyHubHmac` valide les inputs avant compute : pas de NaN timestamp, pas de
  signature vide, longueur hex doit matcher avant `timingSafeEqual`.
- Catch sur exception Buffer → fallback `invalid_signature`. Pas de leak d'info.
- Log warning explicite quand un legacy est accepté pour observabilité.

### Tests

- `src/lib/hub/hmac.test.ts` : 19 tests unitaires (signature correcte/incorrecte,
  drift, secret manquant, body modifié, secret rotaté, formats invalides).
- `__tests__/api/tenants/provision.test.ts` : 11 tests handler dont 4 dédiés au
  pattern A standard (body signé, body tampered, drift, signature bad).

## §6.2 — Bearer api_key tenant (P3 à venir)

Pour `POST /api/workspaces/generateMagicLink`. Voir helper
`extractBearerApiKey` dans `src/lib/hub/hmac.ts`. Une `api_key` = un workspace,
jamais partagée — l'app détecte le partage et retourne 409.

## §6.3 — Bearer Hub webhook token (P5 à venir)

Pour les webhooks app→Hub. Token statique `HUB_WEBHOOK_TOKEN` (env Prospection).
Côté Hub : `PROSPECTION_WEBHOOK_TOKEN`. Stocké dans GitHub Secrets.

## Variables d'environnement

| Var | Rôle | Source |
|---|---|---|
| `HUB_API_SECRET` | Secret HMAC partagé Hub/Prospection | Dokploy ENV (prod) + `.env.staging` (staging) |
| `TENANT_API_SECRET` | Alias historique de `HUB_API_SECRET` (lu en fallback) | idem |
| `HUB_WEBHOOK_TOKEN` | Token Bearer pour les webhooks app→Hub (P5) | À provisionner |
| `ACCEPT_LEGACY_HMAC` | `1`=on (default) / `0`=off | À set `0` après coupure 30j |
| `ACCEPT_LEGACY_BEARER` | `1`=on (default) / `0`=off | À set `0` après coupure 30j |
