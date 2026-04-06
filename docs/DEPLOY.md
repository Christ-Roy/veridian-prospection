# Deploy Guide — Prospection Dashboard

## Auto-deploy (CI/CD)

### Staging
```
git push origin staging
  → CI: unit + build + integration + docker-staging + deploy-staging + e2e
  → If e2e passes: promote-to-main (ff-only merge)
  → ~15 min total
```

### Prod (via auto-promote)
```
promote-to-main triggers push to main
  → CI: unit + build + docker (ghcr.io/:latest) + deploy-prod + e2e-prod
  → If e2e-prod fails: auto-rollback via :rollback tag
  → Telegram notification on success/failure
  → ~10 min after staging green
```

## Manual deploy

### Deploy staging
```bash
# Push staging triggers CI automatically
git push origin staging

# Or manual: pull image + redeploy
ssh dev-pub "docker pull ghcr.io/christ-roy/prospection:staging"
ssh dev-pub "curl -sf -X POST \
  -H 'x-api-key: <DOKPLOY_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{\"json\":{\"composeId\":\"0f3uUHxT5kUdJuZWdApm0\"}}' \
  http://localhost:3000/api/trpc/compose.deploy"
```

### Deploy prod
```bash
# Merge staging to main
git checkout main && git merge origin/staging --ff-only && git push origin main

# Or force redeploy current image
ssh prod-pub "
  docker pull ghcr.io/christ-roy/prospection:latest
  DKEY=\$(grep '^DOKPLOY_API_KEY=' ~/credentials/.all-creds.env | cut -d= -f2)
  curl -sf -X POST \
    -H \"x-api-key: \$DKEY\" \
    -H 'Content-Type: application/json' \
    -d '{\"json\":{\"composeId\":\"xelXB17eNlesUlHqHJCtY\"}}' \
    http://localhost:3000/api/trpc/compose.redeploy
"
```

### Rollback prod
```bash
ssh prod-pub "
  docker tag ghcr.io/christ-roy/prospection:rollback ghcr.io/christ-roy/prospection:latest
  DKEY=\$(grep '^DOKPLOY_API_KEY=' ~/credentials/.all-creds.env | cut -d= -f2)
  curl -sf -X POST \
    -H \"x-api-key: \$DKEY\" \
    -H 'Content-Type: application/json' \
    -d '{\"json\":{\"composeId\":\"xelXB17eNlesUlHqHJCtY\"}}' \
    http://localhost:3000/api/trpc/compose.redeploy
"
```

## Health checks
```bash
# Prod
curl https://prospection.app.veridian.site/api/health
curl https://prospection.app.veridian.site/api/status

# Staging
curl https://saas-prospection.staging.veridian.site/api/health

# Dev server
curl http://100.92.215.42:3000/api/health
```

## Compose IDs
| Env | Compose ID | Container |
|-----|-----------|-----------|
| Prod | xelXB17eNlesUlHqHJCtY | compose-index-solid-state-card-d7uu39-prospection-saas-1 |
| Staging SaaS | 0f3uUHxT5kUdJuZWdApm0 | compose-bypass-bluetooth-feed-tbayqr-prospection-1 |
| Staging (old) | j4wqH-42gbeZini9_Ls2k | — |

## DB migrations before deploy
Always apply SQL migrations to prod DB BEFORE deploying new code that references new columns:
```bash
ssh prod-pub "docker exec -i <db-container> psql -U postgres -d prospection" < dashboard/scripts/YYYY-MM-DD_migration.sql
```

## Critical lesson (2026-04-06)
**NEVER** deploy code that references new DB columns without applying the migration first.
The Prisma schema compiles fine but the runtime crashes with "column does not exist".
# Triggered lun. 06 avril 2026 12:56:15 CEST
# CI cooldown test lun. 06 avril 2026 13:16:05 CEST
# Final CI test lun. 06 avril 2026 13:45:38 CEST
