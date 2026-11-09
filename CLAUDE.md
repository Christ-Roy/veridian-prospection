# Prospection (Atlas) : navigateur du marché sur ODH

> ## 🔴 Règle d'or Veridian — zéro contournement (gravée Robert 2026-06-10)
> **Interdit absolu** : cron bricolé, SQLite/store parallèle, job maison pour
> ÉVITER l'API ou la DB réelle de l'app. On travaille AVEC le vrai système.
> Un blocage (accès, credential) se débloque, il ne se contourne pas.
> Détail : CLAUDE.md racine veridian-platform.

## Ce que c'est

Atlas, servi sur « / » : explorer le marché français (ClickHouse ODH, vue
`odh.company_prospection_current`, 1,3 M d'entreprises non bloquées), le découper en segments versionnés,
les prioriser, les envoyer vers Notifuse. L'ancienne app (base `entreprises`, pipeline, mail, softphone) est
retirée le 09/11 ; archive : tag `archive/prospection-v1-20261109`. Le pipeline commercial vit dans Twenty.

## Stack

- Next.js 15 (App Router) + npm
- Prisma + PostgreSQL, base `prospection` sur la grappe Patroni `pg-saas` depuis le 09/11 (rôle `prospection`)
- Auth.js v5, sessions JWT
- Playwright (e2e), Vitest (unitaires)

## Vision produit (Robert, 09/11) : Prospection devient un navigateur du marché sur ODH

Le pipeline commercial part dans Twenty ; Prospection sert à trouver et qualifier un marché.
Maquette : `docs/maquette/atlas-des-marches.html`. Linear : ROB-173.
Flux (Robert, 09/11) : **analyse du marché → définition de la cible → priorité (scoring froid) → envoi**.
1. **Marché, sur la base maître** (Robert, 10/11) : la première vue montre toutes les entreprises (cube ODH). Un marché
   = segment racine sur les champs `marche` du catalogue (NAF, division, département, forme, effectif, création).
2. **Cible** : segment enfant qui hérite et ajoute les filtres de prospection (contact, web, signaux), sur les fiches
   prospectables ; sa part contactable et sa part du marché s'affichent tout de suite. Rangés en dossiers.
3. **Priorité** : des règles simples « si … alors +N points », suggestions neutres, IA hautement recommandée.
4. **Export** : Excel ou CSV (`/api/atlas/export`, plans payants, 5 000 lignes, tracé), Notifuse à venir.
5. **IA** : boutons pour brancher son IA dans l'app (liens lus au Hub), accueil « avec l'IA / à la main ».
Pilotage par IA via le MCP (Claude, ChatGPT en OAuth par le Hub), jamais d'IA payée par l'app.

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
  sans espace = 403. Claim `tenant_id` (seulement si l'IA choisit un espace) : absent = espace par défaut ;
  relié et membre = cet espace ; relié à rien = 403 `tenant_not_linked` ; non membre = 403 `tenant_forbidden`.
  Jamais de repli silencieux. Ids locaux distincts de ceux du Hub : `tenants.hub_tenant_id`, reçu au
  provisionnement (`hub_tenant_id`, racine ou `metadata`), posé une fois et jamais écrasé, fait le lien.
  Tenants existants : `POST /api/tenants/link-hub` (HMAC, `{hub_user_id, hub_tenant_id}`) ne pose que ce lien.
  Ne pas rejouer `provision` sur un vrai client : il remet le propriétaire `admin` et recrée `default`.
  `by-email` rend `workspaces[].hub_tenant_id` pour `hub reconcile`.
- Outils : `src/atlas/outils-mcp.ts` (17), les mêmes que l'écran appelle par `/api/atlas/[outil]` avec la session.
  Espace déduit de l'utilisateur, un `viewer` ne voit pas les outils d'écriture, fiche limitée à 60/min.
  Ajouter un outil = une entrée dans `OUTILS_ATLAS`, le Hub le relit seul.
- ClickHouse (`src/atlas/source.ts`) : compte `prospection_ro`, 12 requêtes simultanées pour toute l'app, aucun
  réglage par requête (profil readonly). File de 3 par conteneur et rejeu du code 202 : ne pas les retirer.
  Champs = liste blanche `src/atlas/champs.ts`, filtres compilés en paramètres typés (`src/atlas/filtres.ts`).
  `deliverable` d'ODH = joignable par un canal, pas email envoyable. Champ `email_envoyable` = règle provisoire
  d'ODH ; à l'annonce de leur release (ODH-0239), le passer sur leur colonne `email_envoyable = 1`.
- Cube de marché ODH-0245 (`odh.market_cube_current`, `src/atlas/cube.ts`, outil `analyser_marche`, vue « Taille du
  marché ») : le marché ENTIER, pas que les fiches prospectables. Sélection par LISTE de codes NAF avec
  `naf_rev2 = 1`, jamais par intervalle de chaînes ; prévoir « département inconnu » (diffusion partielle) ;
  afficher `nb_*_livrable` comme « envoyables », `nb_avec_*` comme « connus ».
- Registre : `hub mcp-app add prospection https://prospection.app.veridian.site/api/mcp --acces tous` (inscrit le 09/11).
- Journaux : `obs search '\[mcp\] outil=' --since 6h` (Loki) ; `nomad alloc logs` ne rend rien pour ce job.

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
- **Suppression de colonne en deux temps** : d'abord le code sans la colonne (Prisma lit tout le modèle),
  puis la migration de DROP au déploiement suivant ; la CI migre avant de déployer (fait le 09/11, 0035).
- **Pas d'invitation locale** (retirée le 09/11) : inviter crée un utilisateur, c'est le Hub (`/dashboard/workspace/members`).
  La table `invitations` reste (21 lignes, plus lue) ; `notifuse_api_key` est vidée puis supprimée.
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
src/atlas/            # champs, filtres, source ClickHouse, segments (Prisma), outils MCP
src/components/atlas/ # interface (rail, vues, carte, fiche, volets), fidèle à docs/maquette
src/app/api/          # atlas/[outil], mcp, health, contrat Hub (sso, tenants, users)
src/lib/hub/          # contrat Hub
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

Tests et builds : `lourd <commande>` (rise), jamais en local.

## Multi-tenant

- Tables Atlas (`atlas_*`) bornées au tenant. Les tables de l'ancienne app (`entreprises`…) restent en base, plus lues.
- Résolution : session → `tenants.user_id`, sinon `workspace_members` → tenant (cache 60 s).

## Règles

- JAMAIS de signup en e2e (login comptes existants uniquement).
- `checkTrialExpired` = `return false` (hack temporaire, à recâbler).

## Dette connue

- `audit_log` n'existe pas en prod : les audits sont ignorés en silence.
- `prospection-ci.yml` tourne sur `ubuntu-latest` (permis : dépôt public).
- `check-test-mapping.sh` ne voit rien sur un push vers `main`, et le pre-push ne le lance pas.
