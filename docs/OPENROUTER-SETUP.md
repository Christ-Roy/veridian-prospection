# OpenRouter — setup tier gratuit Veridian + OAuth PKCE user

Livré 2026-05-25 (W9d).

## Vue d'ensemble

L'app expose **deux paliers** d'accès à la génération de templates mail IA :

1. **Veridian Free** (clé globale, ENV `OPENROUTER_VERIDIAN_KEY`) — fallback gratuit pour
   tous les tenants n'ayant pas configuré leur propre IA. Plafonné à ~50 req/jour
   partagées (1000/j si Robert dépose 10 USD chez OpenRouter).
2. **User BYO via OAuth PKCE** — l'utilisateur clique "Connecter mon compte OpenRouter"
   dans Settings › Mail › IA, OAuth PKCE retourne une clé `sk-or-v1-...` qui débite
   SON crédit (illimité selon dépôt).

Ordre de résolution dans `src/lib/ai/resolver.ts` :

1. Link user (`user_openrouter_link`) → adapter OpenRouter avec sa clé
2. Config tenant (`tenant_ai_config`) → adapter selon provider (anthropic/openai/mistral/openrouter)
3. Fallback Veridian (`OPENROUTER_VERIDIAN_KEY` env) → adapter OpenRouter clé Veridian + modèle `:free`
4. Aucun → 412 `not_configured`

## Setup côté Robert (one-shot manuel)

Action requise pour activer le fallback Veridian :

1. Aller sur https://openrouter.ai → créer un compte "Veridian Prospection"
   avec robert.brunon@veridian.site
2. Déposer 10 USD pour passer de 50 à 1000 req/jour (cap RPM 20/min reste partagé)
3. Générer une clé "Veridian Prospection Production" (Settings › Keys)
4. Poser dans Dokploy ENV des composes prod + staging :
   - `OPENROUTER_VERIDIAN_KEY=sk-or-v1-...`
5. Redeploy via `POST /api/compose.deploy` (composeId prod : `0mJI-sSt6jcOMr_2QJ1iI`)

Sans cette étape, les tenants sans config IA voient `412 not_configured` sur
`/api/mail/generate` — pas de régression, juste pas de free tier.

## Modèles `:free` whitelistés

Cf. `src/lib/ai/models.ts` :

- `deepseek/deepseek-chat-v3-0324:free`
- `meta-llama/llama-3.3-70b-instruct:free` (← `VERIDIAN_DEFAULT_FREE_MODEL`)
- `google/gemma-2-9b-it:free`

Tests qualité réels mail commercial 200-500 tokens : Llama 3.3 70B free retenu
comme défaut (meilleur français des trois).

## OAuth PKCE — flow user

```
1. UI: GET /api/integrations/openrouter/connect
   → cookie or_pkce signé HMAC(AUTH_SECRET) = { verifier, state, userId, exp(+10min) }
   → 302 redirect https://openrouter.ai/auth?callback_url=...&code_challenge=...&state=...
2. User autorise sur openrouter.ai
3. OpenRouter redirect /api/integrations/openrouter/callback?code=...&state=...
4. callback :
   - vérifie cookie or_pkce (signature HMAC + exp)
   - compare state cookie vs state query → 400 si mismatch (CSRF)
   - vérifie userId cookie == user session → 400 si user-mismatch (anti link-jack)
   - POST https://openrouter.ai/api/v1/auth/keys { code, code_verifier, code_challenge_method: "S256" }
     → { key: "sk-or-v1-...", user_id?: "..." }
   - upsertOpenRouterLink → encrypt AES-256-GCM via AUTH_SECRET → user_openrouter_link
   - 302 redirect /settings/mail?ai=connected (ou ?ai_error=<reason>)
```

## Tables / migrations

- Migration 0031 — `user_openrouter_link` (user_id UNIQUE, api_key_enc TEXT NOT NULL,
  openrouter_email, scope, connected_at, last_used_at, deleted_at). Soft-delete pour
  audit (disconnect = poser `deleted_at`).

## Sécurité

- Clé chiffrée AES-256-GCM via `AUTH_SECRET` (même primitive que `tenant_ai_config.api_key_enc`)
- Cookie PKCE HTTP-only + secure (en prod) + SameSite=Lax + signé HMAC + exp 10 min
- Anti-CSRF : state random 16 bytes b64url
- Anti link-jack : userId stocké dans le cookie, comparé à la session au callback
- Rate limit callback : 10/min/user
- Soft delete sur disconnect (audit trail conservé)

## Pour tester en local

1. Set `OPENROUTER_VERIDIAN_KEY` dans `.env.local` (clé perso ou clé Veridian)
2. `npm run dev`
3. Va sur http://localhost:3000/settings/mail onglet IA
4. Tu dois voir "Génération IA offerte par Veridian" (badge vert)
5. Clique "Connecter mon compte OpenRouter" → redirection vers openrouter.ai
6. Autorise → retour avec toast "Compte OpenRouter connecté"
7. Génère un mail prospect → vérifie `mode: "user-byo"` dans la response

## E2E

Voir `e2e/staging-full/openrouter-oauth.spec.ts` — 10 specs couvrant :
- Happy path connect → callback → key stockée
- CSRF state mismatch → ai_error=state_mismatch
- Cookie expiré → ai_error=pkce_expired
- User mismatch → ai_error=user_mismatch
- OpenRouter 401 sur exchange → ai_error=exchange_auth
- Réseau down → ai_error=exchange_network
- Reconnect écrase la clé précédente
- Disconnect → soft delete + fallback Veridian/tenant
- RBAC : non-auth → 401
- Cross-app : génération mail utilise bien la clé user après connect
