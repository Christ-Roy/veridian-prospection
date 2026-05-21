# 🚨 [PROSPECTION] Fix Telnyx webhook non-authentifié (HIGH sécu)

> **Type** : Sécu critique — RCE/SSRF/DB pollution
> **Sévérité** : 🔴 HIGH (P0 pour prochaine promo prod)
> **Owner** : agent Prospection
> **Créé** : 2026-05-21
> **Découvert** : pentest T16 staging
> **Bloque** : prochaine promo prod tier 🔴+

## TL;DR

`POST /api/phone/telnyx-webhook` accepte **n'importe quel payload sans
signature Telnyx**. PoC confirmé : 3 `call_log` insérés en DB staging
depuis un curl anonyme avec `from_number` arbitraire.

Exploits possibles :
1. **Pollution DB** : créer des milliers de faux call_log
2. **Abuse Telnyx API** : faire faire des actions à `TELNYX_API_KEY`
   (forward, hangup, dial) — facturation réelle
3. **Forward calls** vers le mobile business pendant business hours si
   WebRTC client offline
4. **SSRF interne** : le webhook accepte `recording_urls.mp3` user-controlled
   qui se retrouve fetché par `/api/phone/summarize-call` (à confirmer)
   → SSRF vers metadata cloud, localhost, internal services

## Reproduction (PoC)

```bash
# Forger un call.initiated event sans aucune auth
curl -X POST 'https://prospection.staging.veridian.site/api/phone/telnyx-webhook' \
  -H 'Content-Type: application/json' \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "payload": {
        "from": "+33999000999",
        "to": "+33666666666",
        "call_control_id": "fake-' "$(date +%s)" '"
      }
    }
  }'
# → 200 OK + row insérée dans call_log
```

Vérif post-exploit en DB :
```sql
SELECT * FROM call_log WHERE from_number = '+33999000999';
-- → row visible
```

## Fix attendu

### 1. Vérifier signature Ed25519 Telnyx (mandatory)

Headers Telnyx pour chaque webhook :
- `Telnyx-Signature-Ed25519` (signature)
- `Telnyx-Timestamp` (anti-replay)

Le secret = `TELNYX_PUBLIC_KEY` (clé publique Telnyx fournie dans le
portal Telnyx, à coller en ENV Dokploy).

Algo de vérification :
```typescript
import * as nacl from 'tweetnacl';

function verifyTelnyxSignature(
  publicKey: string,
  payload: string,
  timestamp: string,
  signature: string,
): boolean {
  const message = `${timestamp}|${payload}`;
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    Buffer.from(signature, 'base64'),
    Buffer.from(publicKey, 'base64'),
  );
}
```

Implémenter dans `src/lib/telnyx/verify.ts` + utiliser en début de
`/api/phone/telnyx-webhook/route.ts`.

### 2. Anti-replay drift timestamp ≤ 5 min

Pareil que HMAC Hub : si `Math.abs(Date.now() - parseInt(timestamp) * 1000) > 300000`
→ 401.

### 3. Restreindre IPs source Telnyx (optionnel, defense-in-depth)

Telnyx publie ses ranges IP (cf documentation). Whitelister côté Traefik
ou middleware Next.js.

### 4. Whitelister hosts `recording_url` (fix SSRF)

Dans `/api/phone/summarize-call`, si la route fetch `recording_url` user-
controlled :
- Parser l'URL, vérifier hostname matches `*.telnyx.com` ou domaine listé
- Refuser `localhost`, `127.0.0.1`, IPs privées RFC1918, link-local, metadata
  cloud (169.254.169.254, 100.100.100.200, etc.)
- Vérifier protocole = `https://` uniquement

### 5. Tests

`__tests__/api/phone/telnyx-webhook.test.ts` (nouveau ou étendu) :
- Webhook sans header signature → 401
- Webhook avec signature invalide → 401
- Webhook avec timestamp drift > 5min → 401
- Webhook avec signature valide → 200 + row insérée
- Sabotage-test : casser la vérification → tests échouent

`__tests__/api/phone/summarize-call.test.ts` (si SSRF possible) :
- recording_url = `http://localhost:8080/...` → 400
- recording_url = `http://169.254.169.254/...` → 400
- recording_url = `https://api.telnyx.com/...` → 200

## Provisioning ENV

`TELNYX_PUBLIC_KEY` à coller dans ENV Dokploy compose Prospection prod
(composeId `0mJI-sSt6jcOMr_2QJ1iI`) + staging.

Récupérer la clé depuis le portal Telnyx :
- Dashboard Telnyx → Account Settings → Public Key

## Flow ship

1. Code + tests
2. Push staging
3. CI vert
4. Smoke : refaire PoC ci-dessus → 401 attendu
5. STOP staging (sprint v1.5 staging-only en cours)
6. Quand Robert ouvre la fenêtre promo : bundler avec les autres correctifs
   prod (T7+T11+T13 + migrations DB) + apply `TELNYX_PUBLIC_KEY` ENV prod

## Cleanup déjà fait

T16 a déjà DELETE les 3 call_log forgés en DB staging. Pas de leftover.

## Référence

- Rapport pentest T16 : `/tmp/pentest-report-2026-05-21.md`
- Script reproductible : `/tmp/pentest-staging.sh`
- Doc Telnyx signature : https://developers.telnyx.com/docs/v2/api/webhook-events#webhook-signatures
- Tier sécu : 🔴 HIGH — bloque promo prod
