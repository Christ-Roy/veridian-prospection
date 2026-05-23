# [PROSPECTION] Endpoint `POST /api/sso/issue-magic-link` — Hub livré, ton tour

> **Type** : Endpoint contractuel cross-app (Couche 4 SSO)
> **Sévérité** : 🟡 P2
> **Owner** : agent Prospection
> **Spec parent** : `veridian-hub/docs/CONTRAT-HUB.md` §6bis.8
> **Hub livré** : 2026-05-23
> **Créé** : 2026-05-23

## Statut côté Hub

Le Hub a livré la **Couche 4 — Bounce OAuth** (cf. CONTRAT-HUB §6bis.8) :

- ✅ `/login?next=<url>` valide whitelist regex anti open-redirect
- ✅ Cookie signé `__Secure-veridian-next` (HMAC AUTH_SECRET, TTL 10min)
- ✅ Routes `/api/auth/bounce/{prepare,complete}` câblées
- ✅ Gestion erreurs 5xx / 400 user_not_in_app / cookie absent
- ✅ Tests Vitest exhaustifs

**Ce qui reste à livrer côté Prospection** : l'endpoint
`POST /api/sso/issue-magic-link` qui sera appelé par le Hub en HMAC
après chaque OAuth Hub réussi pour le bounce vers Prospection.

## Spec exacte à livrer

```
POST /api/sso/issue-magic-link
Headers:
  X-Veridian-Timestamp: <unix_ms>
  X-Veridian-Hub-Signature: <hex(hmac_sha256(HUB_API_SECRET, "{ts}.{body}"))>
  Content-Type: application/json
Body:
  { "hub_user_id": "<uuid>", "email": "<string>" }
```

### Réponses attendues

- **200** : `{ "magic_link_url": "https://prospection.app.veridian.site/auth/token?t=..." }`
  - URL DOIT être https + host `*.veridian.site` (Hub valide sinon `invalid_response`)
  - Réutiliser logique magic_link Couche 3 existante
  - Si multi-workspaces : magic link vers le dernier actif
- **400 user_not_in_app** : `{ "error": "user_not_in_app", "hint": "..." }`
  - Hub redirige vers `app.veridian.site/dashboard?app=prospection&hint=signup`
  - **Ne PAS** auto-créer de workspace
- **401/403** : HMAC invalide (Hub traite comme `unreachable`)
- **5xx** : Hub redirige user vers `/auth/bounce/error?app=prospection&code=unreachable`

## ENV côté Prospection

| Var | Convention |
|---|---|
| `HUB_API_SECRET` | secret HMAC partagé (côté Hub = `PROSPECTION_HUB_API_SECRET`) |

Côté Hub : `PROSPECTION_HUB_API_SECRET` déjà configuré (cf.
`veridian-hub/lib/prospection/client.ts:readProspectionSecret`).

## Tests CI bloquants à ajouter (§6bis.8.5)

- HMAC invalide → 401
- HMAC valide + user en local → 200 avec `magic_link_url`
- HMAC valide + user inconnu → 400 `user_not_in_app`
- Magic link suivi → cookie session Prospection posé
- Rate limit 10/min/user

## Bouton UI `/login` Prospection (§6bis.8.1)

```tsx
<Button onClick={() => {
  const next = encodeURIComponent(window.location.href);
  window.location.href = `https://app.veridian.site/login?next=${next}`;
}}>
  <GoogleLogo /> Continuer avec Google
</Button>
// idem Microsoft
```

Pas de provider OAuth local, pas de callback, pas de secrets Google/Microsoft
côté Prospection — tout reste au Hub.

## Estimation

~1 jour (endpoint + tests + boutons UI).

## Référence

- `veridian-hub/docs/CONTRAT-HUB.md` §6bis.8 (intégral)
- `veridian-hub/todo/2026-05-20-fallback-login-apps-redirect-hub.md` (ticket parent)
- Code Hub livré : `veridian-hub/lib/auth/bounce-{next,apps}.ts`,
  `app/api/auth/bounce/{prepare,complete}/route.ts`
