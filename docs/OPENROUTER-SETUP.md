# OpenRouter — setup tier gratuit Veridian (Palier 1)

Livré 2026-05-25 (W9d). Palier 2 OAuth PKCE user link reverté 2026-05-26.

## Vue d'ensemble

L'app expose un fallback gratuit pour la génération IA des templates mail :

**Veridian Free** (clé globale, ENV `OPENROUTER_VERIDIAN_KEY`) — fallback gratuit pour
tous les tenants n'ayant pas configuré leur propre IA. Plafonné à ~50 req/jour
partagées (1000/j si Robert dépose 10 USD chez OpenRouter).

Si un tenant veut sa propre clé (n'importe quel provider : anthropic, openai, mistral,
openrouter), il la pose dans Settings › Mail › IA (BYO clé tenant-wide chiffrée
AES-256-GCM dans `tenant_ai_config`). Sa clé débite alors son propre crédit.

Ordre de résolution dans `src/lib/ai/resolver.ts` :

1. Config tenant (`tenant_ai_config`) → adapter selon provider (anthropic/openai/mistral/openrouter)
2. Fallback Veridian (`OPENROUTER_VERIDIAN_KEY` env) → adapter OpenRouter clé Veridian + modèle `:free`
3. Aucun → 412 `not_configured`

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

## Pour tester en local

1. Set `OPENROUTER_VERIDIAN_KEY` dans `.env.local` (clé perso ou clé Veridian)
2. `npm run dev`
3. Va sur http://localhost:3000/settings/mail onglet IA
4. Tu dois voir l'AiConfigForm — l'admin peut poser sa propre clé tenant
   (BYO) ou laisser vide pour fallback Veridian.
5. Génère un mail prospect → vérifie `mode: "tenant-byo"` ou
   `mode: "veridian-free"` dans la response selon que le tenant a posé
   sa clé ou pas.

## Pourquoi pas d'OAuth PKCE user-link ?

Le Palier 2 (OAuth PKCE OpenRouter par user, table `user_openrouter_link`,
4 routes connect/callback/disconnect/status, AES-256-GCM, anti-link-jack,
cookie HMAC) a été livré le 2026-05-25 puis reverté le 2026-05-26.

Raison : pour le cas d'usage actuel (le user veut utiliser son propre
crédit OpenRouter), coller `sk-or-v1-...` dans le `tenant_ai_config` BYO
suffit. L'overkill OAuth complet (PKCE + state CSRF + cookie signé HMAC
+ anti link-jack + soft-delete + 12 specs E2E) n'apporte rien avant
validation marché — la friction "OAuth pour copier-coller une clé" est
plus pénible que le copier-coller direct.

Re-livrable si le marché demande un compte OpenRouter perso par user
(≠ tenant) — le commit `87e42ff` reste accessible via `git log`.
