# Pattern Dokploy GitOps - procedure standard

> Pilote : **prospection** (2026-05-13). Notifuse devait piloter mais a ete devance.
> Cet apprentissage doit servir aux autres agents apps (hub, analytics, cms, twenty,
> supabase, crowdsec, sites tertiaires) avant qu'ils basculent leur stack.
>
> Sprint reference : `~/Bureau/SPRINT-GITOPS-VERIDIAN.md`

## Objectif

Migrer une stack Dokploy de provider **Raw** (compose colle dans l'UI) vers **Git**
(compose dans le repo, auto-deploy par webhook GitHub). Aboutir a :

- Compose dans `infra/services/<app>/docker-compose.yml`
- Images Docker pinned en `image@sha256:...` (pas de tag flottant)
- ENV via Dokploy UI (jamais commit)
- Webhook GitHub -> Dokploy : `push main` -> redeploy auto
- Healthcheck `/api/health` qui swap zero-downtime
- `DEPLOY_ENV` (prod/green) drive container_name + labels Traefik
- Rollback = `git revert -m 1 <merge-sha>` + push

## Phase A - migration (procedure en 8 etapes)

### Etape 1 - Identifier la stack Dokploy

```bash
ssh prod-pub 'sudo ls /etc/dokploy/compose/'
# Identifier le compose-XXXXXX-XXXXXX qui correspond a ton app
# (souvent un nom auto-genere type "compose-connect-redundant-firewall-l5fmki")
```

### Etape 2 - Snapshot forensique avant toute modif

```bash
APP=<app>
COMPOSE_ID=<compose-id-trouve-ci-dessus>
SNAP_DIR="/tmp/${APP}-gitops-snapshot-$(date +%Y%m%d-%H%M)"
mkdir -p "$SNAP_DIR"

# 1. Compose live
ssh prod-pub "sudo cat /etc/dokploy/compose/${COMPOSE_ID}/code/docker-compose.yml" \
  > "$SNAP_DIR/docker-compose.yml"

# 2. Inspect de chaque container (image SHA, env, network, labels, mounts)
for container in $(ssh prod-pub "sudo docker ps --format '{{.Names}}' | grep ${COMPOSE_ID}"); do
  ssh prod-pub "sudo docker inspect $container" > "$SNAP_DIR/container-${container}.json"
done

echo "Snapshot dir : $SNAP_DIR"
```

**Le snapshot contient des secrets en clair** (toutes les ENV des containers). Le
nettoyer apres usage : `rm -rf $SNAP_DIR` ou le deplacer dans un emplacement sur.

### Etape 3 - Recuperer les digests SHA des images

Pour chaque image upstream du compose (postgres, redis, nginx, etc.) :

```bash
ssh prod-pub "sudo docker image inspect <image:tag> --format '{{json .RepoDigests}}'"
# -> ["registry/image@sha256:..."]
```

Pour ton image applicative (build maison sur GHCR/GHCR-equivalent) :

```bash
ssh prod-pub "sudo docker image inspect ghcr.io/<org>/<app>:<tag> --format '{{json .RepoDigests}}'"
# -> ["ghcr.io/<org>/<app>@sha256:..."]
```

Le `RepoDigests` est l'identifiant **immuable** registry-side (different du
SHA local `.Image`). C'est lui qu'on pinne dans le compose Git.

### Etape 4 - Creer le compose Git-clean

Convention de path : `infra/services/<app>/docker-compose.yml`.

Diffs cle par rapport au compose Raw existant :

| Aspect | Avant (Raw) | Apres (Git) |
|---|---|---|
| Image | `<image>:<tag>` | `<image>@sha256:...` |
| Container name | implicite | `container_name: <app>-${DEPLOY_ENV:-prod}` |
| Healthcheck | souvent absent | obligatoire (test wget/curl `/api/health`) |
| Labels Traefik | hard-codes | `${DEPLOY_ENV:-prod}` + `${TRAEFIK_HOST:-...}` |
| ENV | inline `${VAR}` | `${VAR}` toutes resolves par Dokploy |

#### Piege #1 - les noms de services ne supportent pas l'interpolation

Docker Compose **valide** ce qu'on met dans le nom du service au parsing.
**Ne marche pas** :
```yaml
services:
  prospection-${DEPLOY_ENV:-prod}:   # ERREUR validation
    image: ...
```
Erreur : `services Additional property prospection-${DEPLOY_ENV:-prod} is not allowed`.

**Marche** : nom statique + `container_name` dynamique :
```yaml
services:
  prospection:
    container_name: prospection-${DEPLOY_ENV:-prod}
    image: ...
    labels:
      - traefik.http.routers.prospection-${DEPLOY_ENV:-prod}.rule=Host(`${TRAEFIK_HOST}`)
```

Le label Traefik router porte le suffixe d'env (essentiel pour ne pas avoir 2
routers du meme nom si prod et green tournent en parallele).

#### Piege #2 - les variables d'env reference doivent ETRE dans Dokploy

Tout `${VAR}` dans le compose **doit** etre defini dans `Dokploy UI > Stack >
Environment`. Sinon le `docker compose up` echoue avec un message peu clair.

Lister les vars necessaires dans `infra/services/<app>/.env.example` avec
placeholders (jamais de vrais secrets dans le repo).

#### Piege #3 - le compose Dokploy n'a pas le contexte de build

Si l'app a un `Dockerfile` (pas une image registry), il faut soit :
- Build l'image dans la CI et la pusher sur registry (GHCR), puis pinner
- Ou laisser Dokploy build, mais alors **on perd le SHA pin**

Choisir build CI + push registry pour avoir le pin.

### Etape 5 - Valider la syntaxe localement

```bash
cd infra/services/<app>
DEPLOY_ENV=prod TRAEFIK_HOST=<app>.app.veridian.site \
  DATABASE_URL=test AUTH_SECRET=test ... \
  docker compose -f docker-compose.yml config
```

Le rendu YAML doit etre coherent (verifie container_name, labels, env).

Test aussi avec `DEPLOY_ENV=green` pour s'assurer que les noms switchent bien.

### Etape 6 - PR + merge sur main

```bash
git add infra/services/<app>/ runbooks/ todo/apps/<app>/TODO.md
git commit -m "feat(<app>): GitOps Dokploy migration (Raw -> Git provider)"
git push -u origin feat/<app>-gitops-migration
gh pr create --fill
# CI doit etre verte (lint YAML, type check, tests existants)
gh pr merge --squash --auto
```

### Etape 7 - Bascule Dokploy UI (manuelle, 1 fois par stack)

Cette etape **n'est pas scriptable** via API Dokploy a date (a confirmer).
Procedure UI :

1. Aller sur `https://dokploy.veridian.site`
2. Project `<app>` -> Compose stack
3. Settings -> Provider : **Raw -> Git**
4. Repository : `git@github.com:<org>/veridian-platform.git`
5. Branch : `main`
6. Compose path : `infra/services/<app>/docker-compose.yml`
7. Activer **Auto Deploy** (toggle)
8. Copier l'URL webhook (`https://dokploy.veridian.site/api/webhooks/...`)
9. Coller le webhook dans GitHub repo `Settings > Webhooks > Add webhook` :
   - Payload URL : URL copiee
   - Content type : `application/json`
   - Events : `Just the push event`
   - Active : oui
10. Verifier que les ENV existantes sont toujours dans la stack (sinon Dokploy
    les perd lors du changement de provider)
11. Cliquer **Deploy** (manuel cette fois, pour tester)

### Etape 8 - Smoke + idempotence + rollback

```bash
APP=<app>
DOMAIN=<app>.app.veridian.site

# Smoke 10x
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf -o /dev/null -w "%{http_code} " https://$DOMAIN/api/health
done; echo

# Logs container : aucune 5xx ni erreur
ssh prod-pub "sudo docker logs --since 60s ${APP}-prod 2>&1 | grep -iE 'error|fatal|5[0-9]{2}'"
```

Puis **test idempotence** (commit no-op) :

```bash
# Push un commit qui ne change rien de runtime (ex: commentaire)
git checkout main && git pull
echo "# noop $(date)" >> infra/services/$APP/README.md
git add infra/services/$APP/README.md
git commit -m "chore(${APP}): noop test webhook idempotence"
git push origin main
# Verifier dans Dokploy UI qu'un deploy se declenche -> verifier 0 downtime
```

Puis **test rollback** :

```bash
git revert HEAD --no-edit
git push origin main
# Le webhook redeploy avec le commit precedent
# Verifier que le container est revenu a l'etat avant noop
```

## Phase B - CI security par app

Cf section dedicated `02-ci-loop.md` du brief applicatif.

Workflow `<app>-security-cve.yml` :
- `npm audit --production --audit-level=high` (deja en place pour la plupart des apps)
- `trivy image` sur l'image buildee (CRITICAL + HIGH bloquant, `ignore-unfixed: true`)
- Cron quotidien 3h UTC (detecte CVE upstream apparues apres le merge)

## Phase C - Loop validation 7 jours

Quotidien :
- `obs check security` (zero CRIT/HIGH sur image deployed)
- `gh run list --workflow=<app>-security-cve.yml --limit 5` (toutes vertes)
- `gh pr list --label dependencies` (Dependabot PR, Trivy CI les valide)
- Push un test no-op pour verifier que le webhook fonctionne toujours

Si tout vert pendant 7 jours -> mission complete, marquer dans
`todo/apps/<app>/TODO.md`.

## Pieges rencontres (pilot prospection 2026-05-13)

### #1 - Service name interpolation (FIX cf Etape 4 piege #1)

### #2 - Le compose Raw avait des references inter-app via nom de container interne

Le compose live de prospection contenait :
```yaml
SUPABASE_URL: http://compose-parse-digital-alarm-974mhw-kong-1:8000
```

Ca viole `07-inter-app-communication.md` (URL publique obligatoire). On ne corrige
pas ca dans le sprint GitOps (scope = migration, pas refactor). A ajouter dans
`todo/apps/prospection/TODO.md`.

### #3 - DB hors compose

Le compose prospection deploie SEULEMENT le service applicatif. La DB Postgres
est dans un compose Dokploy separe (`code-prospection-saas-db-1`). C'est OK
pour la migration : on ne migre PAS la DB en meme temps (cycle de vie different).

### #4 - Les composes legacy `infra/docker-compose.*.yml` du repo divergent

Le repo prospection a 17 fichiers `docker-compose.*.yml` a la racine de `infra/`,
heritage de l'epoque pre-Dokploy. **Aucun ne reflete la prod**. Ne pas les
toucher dans cette migration - c'est un cleanup separe.

## Standards verrouilles par ce sprint

Cf `~/Bureau/SPRINT-GITOPS-VERIDIAN.md` section "Standards de l'industrie" :

1. Pinning d'images Docker (SHA digest)
2. Trivy CI bloquant sur build
3. Dependabot/Renovate sur Docker
4. Auto-merge sur patches Trivy-clean
5. Webhook auto-deploy uniquement (pas de deploy UI manuel)
6. Snapshot avant toute manip irreversible
7. Smoke test post-deploy obligatoire
8. Healthchecks Docker partout
9. Volumes nommes explicites
10. Secrets via Dokploy ENV uniquement
