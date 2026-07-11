# Déploiement gitops Nomad — SSH-bastion

> **Runbook de référence Veridian.** Ce dossier porte le modèle de déploiement
> gitops de Prospection sur le cluster Nomad. C'est le **patron que les autres
> apps (Hub, Notifuse, Analytics, CMS) copieront** — d'où le soin apporté à la
> doc. Décision d'architecture arrêtée par Robert le 2026-07-11 :
> **la CI déploie via SSH vers le bastion Nomad, staging ET prod. Le
> `NOMAD_TOKEN` ne quitte jamais le bastion.**

---

## 1. Le modèle en une image

```
   ┌────────────────────┐        push staging / push main
   │  GitHub Actions     │◀───────────────────────────────────────┐
   │  (runner ubuntu)    │                                         │
   └─────────┬───────────┘                                         │
             │ 1. quality gate (lint/tsc/vitest/audit)             │  git push
             │ 2. docker buildx → push GHCR                        │  (agent / CI)
             │    staging : ghcr.io/christ-roy/prospection:staging-<sha7>
             │    prod    : ghcr.io/christ-roy/prospection:<sha7> (+ :latest)
             │
             │ 3. ssh (clé CI dédiée NOMAD_DEPLOY_SSH_KEY)
             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  BASTION CONTABO  (alias ssh `contabo`, hostname vmi3425760)  │
   │  ── control-plane Nomad (NOMAD_ADDR Tailscale, token in situ) │
   │                                                              │
   │  a. scp  deploy/prospection[-staging].nomad.hcl → /tmp/…      │
   │  b. source ~/credentials/nomad-bastion.env                   │
   │     export NOMAD_ADDR NOMAD_TOKEN="$NOMAD_MGMT_TOKEN"        │
   │  c. nomad job validate -var image_tag=<tag> <hcl>           │
   │  d. nomad job plan     -var image_tag=<tag> <hcl>  (|| true) │
   │  e. nomad job run -detach -var image_tag=<tag> <hcl>        │
   │  f. poll `nomad job status <job>` → Latest Deployment ok     │
   │  g. prisma migrate deploy (container éphémère, cf §5)        │
   └───────────────────────────┬──────────────────────────────────┘
                               │ Nomad ordonnance l'alloc
              ┌────────────────┴─────────────────┐
              ▼                                   ▼
   provider=ovh-dev (dev-pub)          provider=contabo (bastion)
   job "prospection-staging"           job "prospection"
   ── DB postgres:16 (app + devclone)  ── DB postgres:15 (prod)
   ── app :3000 + search-dev :3200     ── app :3000
   ── privé (internal-only@nomad)      ── public (prospection.app.veridian.site)
```

Puis, côté runner : **smoke** via l'ingress (`/api/health`, `/api/auth/providers`,
`/login`). En staging le runner rejoint le **tailnet** (staging privé) ; en prod
le curl est direct (public) + vérif anti-stale du SHA actif (`/api/version`).

---

## 2. Pourquoi SSH-bastion (et pas un token Nomad dans la CI)

- **Le `NOMAD_MGMT_TOKEN` ne quitte jamais le bastion.** Il est lu *in situ*
  (`source ~/credentials/nomad-bastion.env`) dans la session SSH. Aucun secret
  Nomad, aucune URL de DB, aucun secret applicatif ne transite par GitHub.
- **Les secrets applicatifs vivent dans les Nomad Variables**
  (`nomad/jobs/prospection` et `nomad/jobs/prospection-staging`), injectés côté
  cluster par `template { env = true }`. La CI ne les voit pas.
- **Surface CI minimale** : la CI ne détient qu'une **clé SSH dédiée** vers le
  bastion (périmètre : ouvrir la session). Rien d'autre.
- **Traçable** : on `scp` le fichier HCL (pas de stdin) → `plan` puis `run` sur
  le même fichier, lisible dans les logs du run.

---

## 3. Fichiers du modèle

| Fichier | Rôle |
|---|---|
| `deploy/prospection.nomad.hcl` | **PROD** — job Nomad `prospection`, `provider=contabo`, DB postgres:15 co-localisée, var `image_tag` (défaut `latest`). |
| `deploy/prospection-staging.nomad.hcl` | **STAGING** — job Nomad `prospection-staging`, `provider=ovh-dev`, DB postgres:16 (`prospection` + `prospection_devclone` 996K), banc `search-dev`, privé (`internal-only@nomad`), var `image_tag` (défaut `staging-<sha>`). |
| `.github/workflows/prospection-deploy-staging.yml` | Pipeline staging (push `staging`). Jobs : `quality` → `build` → `deploy` (Nomad SSH-bastion) → `smoke`. |
| `.github/workflows/prospection-ci.yml` | Pipeline prod (push `main`). Jobs : `quality` → `audit` → `build` → `integration` → `docker` (build+push) → `deploy-prod` (Nomad SSH-bastion). |

> ⚠️ **Le HCL déployé est CELUI DU REPO** (`deploy/*.nomad.hcl`), qui **déclare
> `variable "image_tag"`**. Ne jamais pointer le `run` sur la copie du bastion
> `~/nomad-veridian/jobs/` : elle est plus vieille et n'a PAS le bloc `variable`
> → `nomad job plan -var image_tag=…` échoue en `Undefined -var variable image_tag`.

---

## 4. Les secrets GitHub requis

À poser **une seule fois**, partagés entre les deux workflows (staging + prod) :

| Secret | Contenu | Comment le poser |
|---|---|---|
| `NOMAD_DEPLOY_SSH_KEY` | Clé SSH **privée** ed25519 **dédiée CI**. Sa publique est dans `~brunon5/.ssh/authorized_keys` du bastion. **Ne PAS réutiliser** `github-actions-deploy` (dev-pub). | `ssh-keygen -t ed25519 -f ci-nomad-deploy -C "ci-nomad-deploy@github" -N ""` → publique dans `authorized_keys` du bastion → `gh secret set NOMAD_DEPLOY_SSH_KEY < ci-nomad-deploy` |
| `NOMAD_BASTION_HOST` | Hostname/IP **publique** du bastion Contabo (celui derrière l'alias `contabo` = `vmi3425760`). Sert de cible SSH + `ssh-keyscan`. | `gh secret set NOMAD_BASTION_HOST -b "<ip-ou-hostname-public>"` |
| `NOMAD_BASTION_USER` | User SSH sur le bastion = `brunon5` (propriétaire de `~/credentials/nomad-bastion.env` et de `/usr/bin/nomad`). | `gh secret set NOMAD_BASTION_USER -b "brunon5"` |

Secrets **déjà en place, conservés** :

| Secret | Rôle | Ne pas casser |
|---|---|---|
| `CR_PAT` | PAT cross-repo : clone du submodule privé `veridian-infra` (jobs `quality`/`build`) **et** login/push GHCR. | Le job deploy Nomad n'en a pas besoin (il ne touche pas au submodule ni au registry), mais quality/build/docker oui. |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | Le job `smoke` staging rejoint le tailnet pour curler l'URL privée. | Conservés (staging = `internal-only@nomad`). |
| `STAGING_SUPABASE_ANON_KEY` / `PROD_SUPABASE_ANON_KEY` | `build-arg` NEXT_PUBLIC injecté au build de l'image. | Conservés (inlinés dans le bundle). |

Secrets **devenus INUTILES** (à retirer une fois le compose Dokploy mort — cf §9) :

```
DEPLOY_SSH_KEY            # clé dev-pub ubuntu de l'ancien deploy compose
STAGING_DATABASE_URL      # la DB URL vit maintenant dans la Nomad Variable
STAGING_AUTH_SECRET       # idem — secrets app côté cluster
STAGING_TENANT_API_SECRET
STAGING_HUB_API_URL
STAGING_HUB_WEBHOOK_TOKEN
STAGING_TELNYX_PUBLIC_KEY
DOKPLOY_API_KEY           # ⚠️ secret PROD — le retirer réduit la surface d'attaque
```

> Tant que ces secrets traînent, on garde une DB URL en clair + un token prod
> Dokploy dans la CI **pour rien**. Les supprimer est un gain de sécurité net.

---

## 5. Migrations Prisma — le point subtil

### Diagnostic (état vérifié 2026-07-11)

- **PROD** (`prospection-saas-db-…`, postgres:15, db `prospection`) :
  `_prisma_migrations` = **31/31 applied**, baseline propre → `migrate deploy` = **no-op**.
- **STAGING app** (`db-…`, postgres:16, db `prospection`) : **31/31 applied** → **no-op**.
- **STAGING banc** (`prospection_devclone`, 1,8M entreprises) : **24/31** — retard
  réel (manque 0025→0031, additifs). **Mise à niveau one-shot MANUELLE par le lead**,
  hors CI (c'est le banc de recherche, DB séparée). Cf §8.

### Pourquoi le migrate ne peut PAS tourner depuis le runner

La DB est **co-localisée** avec l'app dans le **même namespace réseau** de l'alloc
(bridge Nomad, pause container partagé). Postgres écoute sur `127.0.0.1:5432`
**sans port publié** → injoignable en TCP externe *et* via Tailscale. Le container
app n'embarque pas le CLI prisma (hygiène CVE). Donc :

> **Le `migrate deploy` tourne via un container éphémère qui JOINT le namespace
> réseau de l'alloc** (`--network container:<db-container>`), ce qui résout
> `127.0.0.1:5432` exactement comme l'app.

- **Staging** : l'alloc est sur **ovh-dev** (dev-pub). Le bastion rebondit
  (`ssh dev-pub`), y pousse `prisma/` et lance le container migrate.
  Container DB = `db-<allocID>`, user `app`, db `prospection`.
- **Prod** : l'alloc est sur le **bastion** lui-même → migrate en local (pas de hop).
  Container DB = `prospection-saas-db-<allocID>`, user `postgres`, db `prospection`.

Le mot de passe est lu **in situ** (`docker exec <db> printenv POSTGRES_PASSWORD`),
jamais dans la CI. Idempotent (`migrate deploy` skip les migrations déjà présentes).

### Ce que ça n'est PAS

Ce n'est **pas** un recâblage du « migrate auto depuis le runner » interdit par le
§20 du repo. Le §20 vise le migrate lancé côté runner GHA sur une DB distante ;
ici on migre **in situ**, sur fenêtre de deploy contrôlée, contre la DB de l'alloc,
en gate idempotent. Une **migration destructive** (DROP COLUMN, ALTER NOT NULL sur
rows existantes) reste **tier 💀 CRITIQUE** : opération manuelle, sur fenêtre, avec
backup frais (all-cron nightly 03:30) et go/stop explicite de Robert.

---

## 6. Déployer / rejouer à la main

### Redeploy staging d'un tag précis (sans rebuild)

```bash
gh workflow run "Prospection Deploy Staging" -f image_tag=staging-<sha7>
```
(le `workflow_dispatch` accepte un input `image_tag` optionnel — vide = build du HEAD.)

### Déploiement 100 % manuel depuis le bastion

```bash
ssh contabo
source ~/credentials/nomad-bastion.env
export NOMAD_ADDR NOMAD_TOKEN="$NOMAD_MGMT_TOKEN"

# depuis une copie du HCL du repo (jamais ~/nomad-veridian/jobs/ !) :
nomad job validate -var "image_tag=staging-<sha7>" prospection-staging.nomad.hcl
nomad job plan     -var "image_tag=staging-<sha7>" prospection-staging.nomad.hcl   # exit 1 = normal
nomad job run -detach -var "image_tag=staging-<sha7>" prospection-staging.nomad.hcl

# vérifier :
nomad job status prospection-staging      # Latest Deployment = successful
```

### Vérifs santé

```bash
# staging (depuis le tailnet) :
curl -s -o /dev/null -w '%{http_code}' https://prospection.staging.veridian.site/api/health   # 200

# prod (public) :
curl -s -o /dev/null -w '%{http_code}' https://prospection.app.veridian.site/api/health       # 200
curl -fsS https://prospection.app.veridian.site/api/version | jq -r '.commit_sha[0:7]'         # == sha7 déployé

# dashboard humain (tous les domaines + jobs d'un coup) :
ssh contabo 'nomad-v state'
```

---

## 7. Rollback

Nomad versionne chaque soumission de job. Deux voies :

### Voie 1 — repointer le tag (recommandée, gitops)

Les images sont sur GHCR (rétention illimitée) → tout tag antérieur est re-pullable.

```bash
# à la main sur le bastion :
nomad job run -detach -var "image_tag=<sha_precedent>" prospection.nomad.hcl        # prod (<sha> sans préfixe)
nomad job run -detach -var "image_tag=staging-<sha_precedent>" prospection-staging.nomad.hcl  # staging

# ou via la CI (staging) :
gh workflow run "Prospection Deploy Staging" -f image_tag=staging-<sha_precedent>
```

### Voie 2 — `nomad job revert` (si le HCL lui-même a changé)

```bash
nomad job history -p prospection            # lister les versions
nomad job revert prospection <version>      # restaure le HCL de cette version (image_tag figé à l'époque)
```
⚠️ `revert` restaure aussi l'`image_tag` figé de cette version → cohérent seulement
si l'image existe encore sur GHCR (toujours vrai, rétention illimitée).

### Prod — protocole §20 (veto Robert)

Le mot-clé **`rollback`** = `git revert` + push `main` (re-déclenche la CI qui
re-déploie le SHA d'avant) + monitoring jusqu'à recovery. Un rollback **d'image
app** est safe et quasi-instantané. Un rollback de **schéma DB** (migration) est
une opération **manuelle** avec backup frais — jamais automatique.

> Filet froid extrême : les volumes/images des anciennes stacks Dokploy sont
> conservés sur prod-pub (décommission 2026-07-10). Hors-process, en tout dernier recours.

---

## 8. Mise à niveau one-shot du banc `prospection_devclone` (lead uniquement)

Le banc de recherche (`prospection_devclone`, 1,8M entreprises) est en retard
24→31 (manque 0025→0031, additifs, non destructifs). Ce n'est **pas** touché par
la CI de deploy app. Mise à niveau manuelle, depuis dev-pub :

```bash
# 1. container DB de l'alloc staging courant :
ssh dev-pub 'docker ps --format "{{.Names}}" | grep "^db-"'

# 2. migrate deploy contre devclone (applique 0025→0031) :
DB=<db-container>
ssh dev-pub "DB_PASS=\$(docker exec $DB printenv POSTGRES_PASSWORD); \
  docker run --rm --network container:$DB -v /home/ubuntu/prospection-staging/prisma:/app/prisma -w /app \
  -e DATABASE_URL=\"postgresql://app:\$DB_PASS@127.0.0.1:5432/prospection_devclone?connection_limit=5\" \
  node:22-alpine sh -c 'apk add --no-cache openssl >/dev/null && npm i -g prisma@6.19.2 --silent && prisma migrate deploy'"

# 3. vérifier (attendu : 31) :
ssh dev-pub "docker exec $DB psql -U app -d prospection_devclone -tAc 'SELECT count(*) FROM _prisma_migrations'"
```

---

## 9. Nettoyage post-migration (à faire une fois le Nomad validé en prod)

Une fois le deploy Nomad éprouvé, retirer l'héritage compose/Dokploy :

- **Workflow** `.github/workflows/prospection-staging-teardown.yml` — sans objet
  (teardown compose dev-pub). À supprimer.
- **Secrets GH inutiles** : `DEPLOY_SSH_KEY`, `STAGING_DATABASE_URL`,
  `STAGING_AUTH_SECRET`, `STAGING_TENANT_API_SECRET`, `STAGING_HUB_API_URL`,
  `STAGING_HUB_WEBHOOK_TOKEN`, `STAGING_TELNYX_PUBLIC_KEY`, `DOKPLOY_API_KEY`
  (cf §4). `DOKPLOY_API_KEY` est un **secret prod** — le retirer réduit la surface.
- **Ancien container compose** `prospection-staging-prospection-1` sur dev-pub
  (résidu du compose Dokploy) : `ssh dev-pub 'docker rm -f prospection-staging-prospection-1'`.
- Le crawler Playwright a été retiré du smoke (il dépendait du réseau docker
  `staging-edge` + DNS `postgres-staging:5432` morts). Recâblage Nomad-aware =
  ticket dédié si besoin.

---

## 10. Comment une AUTRE app copie ce patron

1. Écrire `deploy/<app>.nomad.hcl` + `deploy/<app>-staging.nomad.hcl` avec un bloc
   `variable "image_tag"`, `constraint ${meta.provider}`, DB co-localisée (ou
   externe selon le cas), un `service` + `check /api/health`, secrets en Nomad
   Variable `nomad/jobs/<app>[-staging]` + `template{ env = true }`.
   Valider : `nomad job validate <hcl>` sur le bastion.
2. Copier les jobs `deploy` / `deploy-prod` des workflows Prospection en adaptant :
   `NOMAD_JOB`, `JOB_FILE`, le tag (`staging-<sha>` vs `<sha>`), le container DB
   (`db-<alloc>` vs `<task>-<alloc>`), l'user/db du DATABASE_URL migrate, et le
   `curl` de smoke (tailnet si privé, direct si public).
3. Réutiliser les **mêmes secrets partagés** `NOMAD_DEPLOY_SSH_KEY`,
   `NOMAD_BASTION_HOST`, `NOMAD_BASTION_USER` (ils sont cross-app).
4. Respecter le §20 (promotion graduée par risque) : la promo `main` reste
   déclenchée par l'agent, pas en auto-merge.

---

## 11. Pièges (checklist avant chaque deploy)

1. **HCL du repo, pas la copie bastion** — sinon `Undefined -var variable image_tag`.
2. **`/usr/bin/nomad` brut**, pas le wrapper `nomad-v` (hors PATH headless + ne passe pas `-var`).
   Var d'env : le fichier la nomme `NOMAD_MGMT_TOKEN`, l'exporter en `NOMAD_TOKEN`.
3. **`nomad job plan` renvoie exit 1** quand il y a des allocs à créer (by design) → `|| true`.
4. **`nomad job run` BLOQUANT (sans `-detach`)** : nomad monitore le déploiement de la nouvelle
   version et rend l'exit correct (0 healthy / ≠0 échec/auto-revert). ⚠️ NE PAS repartir sur
   `-detach` + poll `nomad job status` : "Latest Deployment" peut afficher le "successful" de
   l'ANCIEN déploiement une fraction de seconde avant que le nouveau ne s'enregistre → **faux vert**
   qui laisse tourner l'ancienne version (incident 2026-07-11). Le run bloquant élimine cette race.
5. **Migration = manuelle hors-CI pour le destructif** (§5) ; le `migrate deploy` de la CI
   est idempotent/additif seulement.
6. **Auth GHCR = au niveau daemon des nœuds** → PAS de `docker login`/`auth` dans les jobs
   ni sur le bastion pour le pull.
7. **`ssh-keyscan` du bastion AVANT le premier ssh** (StrictHostKeyChecking headless).
   Clé **dédiée CI** (`NOMAD_DEPLOY_SSH_KEY`), pas la clé dev-pub.
8. **Staging privé** (`internal-only@nomad`, ipAllowList 100.64/10) → smoke via **tailnet**.
   Prod publique → curl direct.
9. **Prod STATEFUL** (DB co-localisée, count=1) : un `run` recrée l'alloc → **bref redémarrage DB**.
   Acceptable pour un deploy d'image app ; pas zéro-downtime tant que la DB partage le group
   (cible : Patroni HA, cf `nomad-veridian/tickets/TICKET-001`).
10. **Tag différent par env** : staging = `staging-<sha7>`, prod = `<sha7>` sans préfixe (+ `latest`).
    Mauvais `-var image_tag` → `ImagePullBackOff`.
11. **Auth ghcr des IMAGES PRIVÉES — le piège n°1 (incident 2026-07-11)** : le plugin docker de
    Nomad n'a **pas** de bloc `auth` → Nomad **ne peut pas puller une image privée ghcr** (manifest
    HEAD → `401 unauthorized`) et l'alloc reste `pending` jusqu'au `healthy_deadline` (staging 502).
    Les images publiques (postgres, node) passent ; SEULE l'image app privée coince. **Solution
    retenue** (déterministe, sans toucher au Nomad agent) : la CI **pré-pull l'image AVEC auth sur
    le nœud cible AVANT `nomad job run`** — staging via `ssh dev-pub 'docker pull …'`, prod via
    `docker pull` local sur le bastion. **Prérequis node (one-shot)** : chaque nœud qui ordonnance
    l'app doit avoir un `docker login ghcr.io` valide pour **root** (le user du Nomad agent) ET pour
    le user SSH (dev-pub=ubuntu, bastion=brunon5). Vérifié posé sur ovh-dev + bastion le 2026-07-11.
    → Une autre app qui copie ce patron : s'assurer que ses nœuds ont l'auth ghcr root + garder le
    step pré-pull. (Durcissement futur : `auth { config = "/root/.docker/config.json" }` dans le
    plugin docker de `/etc/nomad.d` + reload agent — rend le pré-pull superflu, mais touche l'infra
    node → coordonné avec l'agent nomad-veridian.)
