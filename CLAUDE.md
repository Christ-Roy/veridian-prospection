# Prospection — Dashboard B2B SaaS

> ## 🔴 Règle d'or Veridian — zéro contournement (gravée Robert 2026-06-10)
> **Interdit absolu** : cron bricolé, SQLite/store parallèle, job maison pour
> ÉVITER l'API ou la DB réelle de l'app. On travaille AVEC le vrai système.
> Un blocage (accès, credential) se débloque, il ne se contourne pas.
> Détail : CLAUDE.md racine veridian-platform.

## Ce que c'est

Dashboard de prospection commerciale B2B : 1,8 M d'entreprises françaises, scoring
technique, données INPI, pipeline, mail, softphone, multi-tenant.

## Stack

- Next.js 15 (App Router) + npm
- Prisma + PostgreSQL, base `prospection` sur la grappe Patroni `pg-saas` depuis le 09/11 (rôle `prospection`)
- Auth.js v5, sessions JWT
- Playwright (e2e), Vitest (unitaires)

## Identité : le Hub est la source de vérité

Contrat : `veridian-hub/docs/CONTRAT-HUB.md`.

- **Entrée** : rebond Hub. `POST /api/sso/issue-magic-link` (HMAC) émet un jeton
  `sso_login_tokens` (haché, one-shot, 15 min, lié au user), `GET /api/auth/token` le consomme.
- **HMAC §6.1 `{ts}.{body}` est le seul mode Hub.** Bearer et `email:ts` sont coupés.
- **`users.hub_user_id` contient `hub_app.users.supabase_user_id`**, pas le cuid `users.id`.
- **Le repli par email ne sert qu'à rattacher un compte sans lien.** Un compte lié à une
  autre identité Hub est refusé.
- **Portes locales fermées en production** : mot de passe et invitation locaux répondent non. `LOCAL_AUTH_ENABLED=1` ne les garde qu'au staging, pour les e2e. Réouvrir en prod demande un déploiement et une décision de Robert.
- **Sans tenant, pas d'accès** : `requireAuth` répond 403 `no_workspace`, sinon les requêtes retombent sur le tenant factice `00000000-…`.
- **Pas de provider OAuth local** : Google et Microsoft passent par le Hub.
- `GET /api/users/by-email` expose `workspaces[].tenant_id`, cible de `update-plan` côté Hub.

## MCP (contrat `veridian-hub/docs/CONTRAT-MCP.md`, 09/11)

- `POST /api/mcp`, Streamable HTTP sans état (JSON, pas de session). Seule la porte du Hub l'appelle.
- Jeton : JWT ES256 du Hub vérifié par `src/lib/mcp/jeton-hub.ts` (WebCrypto, JWKS du Hub en cache 1 h,
  `aud` = `MCP_PUBLIC_URL`, défaut `https://prospection.app.veridian.site/api/mcp`). Utilisateur retrouvé par
  `hub_user_id`, jamais créé ; inconnu = 401 avec `hub_user_unknown` (le Hub crée le compte et réessaie),
  sans espace = 403. Claim `tenant_id` : retenu seulement si l'utilisateur est propriétaire ou membre de ce
  tenant local, sinon espace par défaut. Prospection ne stocke pas l'id du tenant Hub (ids locaux distincts).
- Outils (`src/lib/mcp/outils.ts`) : mêmes fonctions que les écrans, espace déduit de l'utilisateur,
  plafond du plan appliqué, fiche par `serveLeadDetail` (quota, 30/min, masquage partagés avec l'écran).
  Un `viewer` ne voit pas `changer_statut`. Ajouter un outil = une entrée dans `OUTILS`, le Hub le relit seul.
- Registre : `hub mcp-app add prospection https://prospection.app.veridian.site/api/mcp --acces tous`.

## Déploiement et promotion

On travaille sur `main`, la branche qui déploie. La branche `staging` a divergé : ne pas y merger
sans regarder.

Prod : UN SEUL chemin. Un push sur `main` : la CI construit `ghcr.io/christ-roy/prospection:<sha7>`,
puis le job `deploy-prod` envoie le HCL du commit (`deploy/prospection.nomad.hcl`) et ce tag au bastion
par le verbe `veridian-ci-deploy prospection` (put-job, plan, deploy canari, smoke, cleanup). Clé
`prospection-ci-deploy` (cles-ci.tsv), commande forcée, aucun `nomad job run` à la main.
- `image_tag` n'a AUCUN défaut : un défaut figé a fait reculer la prod (09/11 : c70ba3c servi 0537d22).
  `scripts/ci/check-image-tag-sans-defaut.py` refuse tout défaut, auto-test compris (quality).
- Ne jamais déployer à la main : `nomad-v deploy` et `nomad job run` ignorent le tag CI.
- Le job prod est sur `ovh-prod` (contrainte `meta.provider`), pas sur le bastion : le verbe pré-pull
  là où tourne l'allocation.
- Vérifier après déploiement : `nomad job inspect prospection` (image) puis `docker ps` sur `prod-pub`.

Staging (branche `staging`, job `prospection-staging`) : le job servi est à `count 0` ou `dead` selon
le moment, et un conteneur `staging-2ad7ecc` tourne sur `dev-pub` en parallèle (09/11). Le
`prospection-deploy-staging.yml` de cette branche pousse encore en Compose sur `ovh-dev` (chemin
retiré, clé `ubuntu` en mode deny). Ne pas pousser sur `staging` avant d'avoir tranché la source.

| Tier | Exemples | Action agent |
|---|---|---|
| 🟢 BAS | doc, todo, test seul | publier |
| 🟡 MOYEN | route non-auth, UI | tests verts, publier |
| 🔴 HAUT | auth, migration, lib partagée, job Nomad | parcours réel en prod, surveillance, `auto_revert` en filet |
| 💀 CRITIQUE | DROP COLUMN, rotation de secret, refonte session | go/stop explicite de Robert |

### Pièges

- **Migrations Prisma par la CI** : `deploy-prod` envoie `prisma/` au verbe (`put-migrations prod`)
  puis `migrate prod` joue `prisma migrate deploy` sur pg-saas, avant le déploiement. Une migration
  destructive (DROP, renommage) reste 💀 : en deux temps, compatible avec le code encore servi.
- **L'ancienne base `prospection-db` est purgée (09/11)** : job, données, dépôts pgBackRest et R2 supprimés, dump froid vérifié sur le stockage Contabo. Aucun nom `prospection-db` ni `prospection-saas-db` ne doit revenir dans la CI ni dans les skills.
- **Bascule pg-saas (base muette)** : `src/lib/db-bornes.ts` borne l'ouverture des connexions (posé au
  démarrage par `src/instrumentation.ts`). Une requête en cours sur une connexion muette attend sans fin
  dans Prisma 6, `socket_timeout` compris (mesuré) : le filet est `/api/health` (503 en 2 s) + `check_restart`.
  Ne pas allonger ce délai ni retirer `check_restart` (`__tests__/lib/db-bornes.test.ts` le refuse).
- **Un seul client Prisma** (`src/lib/prisma.ts`), pool de 8 (pg-saas : 100 connexions pour cinq apps).
  Jamais de `new PrismaClient` ailleurs : un test le refuse.
- **Rôle `prospection` : `statement_timeout` et `idle_in_transaction_session_timeout` à 60 s** (09/11).
  Une migration longue (index sur `entreprises`) commence par `SET statement_timeout = 0;`.
- **Un déploiement remplace toute l'allocation** du groupe `stack` : l'id d'alloc change.
- **Après déploiement, lire l'image et la version dans le conteneur** ; `/api/status` renvoie
  `commit: null` et ne prouve rien.
- **Un compte de test doit avoir une adresse prouvée au Hub** pour rebondir : sinon il revient sur
  `/dashboard`, et c'est le comportement voulu. Une invitation réellement envoyée prouve l'adresse.
- **Jamais de test sur le compte d'un vrai client.**
- **Conteneur Docker ad hoc** : `guard-docker-noeuds.py` le refuse s'il n'est pas déclaré.

### Veto Robert

| Mot-clé | Effet |
|---|---|
| `stop` / `attends` | Annule la promo en cours ou bloque la prochaine |
| `rollback` | `git revert` + push main + redéploiement jusqu'à recovery |
| `freeze` / `unfreeze` | Gèle ou reprend les mises en prod |

## Structure

```
src/app/api/     # 117 routes : leads, pipeline, mail, admin, contrat Hub, /api/search
src/components/  # écrans (dashboard, mail, billing, softphone)
src/lib/queries/ # requêtes métier
src/lib/hub/     # contrat Hub
src/lib/mail/    # mail
e2e/core/        # BLOQUANTS, voir .claude/rules/core-tests.md
e2e/extended/    # non bloquants
e2e/integration/ # exigent Postgres (DATABASE_URL), échouent sans
__tests__/       # routes et lib en Vitest
deploy/          # jobs Nomad prod et staging
docs/            # dont ETAT-DES-LIEUX-CHANGEMENT-DE-TETE.md
```

## Commandes

```bash
npm ci
npm run build
npx tsc --noEmit
npx vitest run --exclude 'e2e/integration/**'
npx playwright test e2e/core/ --project=chromium
```

Build d'image et tests lourds sur un nœud libre, pas sur le bastion.

## Multi-tenant

- `tenant_id` sur les tables opérationnelles ; `entreprises`, `users` et `verification_tokens` n'en ont pas.
- Résolution : session → `tenants.user_id`, sinon `workspace_members` → tenant (cache 60 s).
- Les tenants locaux n'ont pas toujours l'id du tenant Hub.

## Règles

- JAMAIS de signup en e2e (login comptes existants uniquement).
- `checkTrialExpired` = `return false` (hack temporaire, à recâbler).

## Dette connue

- `audit_log` n'existe pas en prod : les audits sont ignorés en silence.
- `prospection-ci.yml` tourne sur `ubuntu-latest`, permis car le dépôt est public. Les images de prod sont construites par cette CI, pas de `docker build` sur un nœud.
