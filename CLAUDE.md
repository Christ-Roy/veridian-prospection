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
- Prisma + PostgreSQL, base co-localisée dans le job Nomad
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
- **Portes encore ouvertes, décision de Robert** : mot de passe local `/login` (usage journalisé
  par `[auth/password-login]`) et invitation locale `/invite/[token]`. On ne les ferme pas sans chiffre.
- **Pas de provider OAuth local** : Google et Microsoft passent par le Hub.
- `GET /api/users/by-email` expose `workspaces[].tenant_id`, cible de `update-plan` côté Hub.

## Déploiement et promotion

On travaille sur `main`, la branche qui déploie. La branche `staging` a divergé : ne pas y merger
sans regarder.

Prod : job Nomad `deploy/prospection.nomad.hcl` (toujours ce fichier, jamais une copie).

```bash
source ~/credentials/nomad-bastion.env; export NOMAD_ADDR NOMAD_TOKEN="$NOMAD_MGMT_TOKEN"
/usr/bin/nomad job plan -var image_tag=<sha> deploy/prospection.nomad.hcl
/usr/bin/nomad job run -var image_tag=<sha> deploy/prospection.nomad.hcl
```

| Tier | Exemples | Action agent |
|---|---|---|
| 🟢 BAS | doc, todo, test seul | publier |
| 🟡 MOYEN | route non-auth, UI | tests verts, publier |
| 🔴 HAUT | auth, migration, lib partagée, job Nomad | parcours réel en prod, surveillance, `auto_revert` en filet |
| 💀 CRITIQUE | DROP COLUMN, rotation de secret, refonte session | go/stop explicite de Robert |

### Pièges

- **Migrations Prisma à la main** : la CI ne les applique pas. Appliquer avant de déployer le code
  qui en dépend, dans l'allocation via la tâche `prospection-saas-db`, et inscrire la ligne dans
  `_prisma_migrations`.
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
- `prospection-ci.yml` tourne encore sur `ubuntu-latest`.
