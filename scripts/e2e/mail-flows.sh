#!/usr/bin/env bash
# E2E flows mail — script opt-in.
#
# Lance les 5 specs e2e/flows-mail/ via un container Playwright éphémère
# sur dev-pub, branché sur le réseau staging-edge. Le container voit :
#   - prospection.staging.veridian.site (Traefik HTTPS) ou
#     prospection-staging-prospection-1:3000 (hostname interne)
#   - postgres-staging (DB) en hostname interne
#   - mailpit-staging (SMTP 1025 + HTTP 8025) en hostname interne
#
# Pré-requis : un container mailpit-staging up sur le réseau staging-edge.
# Le script le démarre tout seul si absent — image axllent/mailpit, pas
# de volume persistant (purge automatique en beforeEach des specs).
#
# Pourquoi pas en CI bloquante : ~3-5 min, dépend du staging UP + DB réelle
# + mailpit. Outil agent opt-in à lancer manuellement (ou par un team-lead
# avant promo) — pattern §20.6 staging-full.
#
# Usage :
#   bash scripts/e2e/mail-flows.sh
#   PROSPECTION_URL=https://prospection.staging.veridian.site bash scripts/e2e/mail-flows.sh
#
# Variables :
#   PROSPECTION_URL   = URL ciblée (par défaut staging)
#   DATABASE_URL      = pointer sur LA MÊME DB que PROSPECTION_URL
#                       (récupéré auto de prospection-staging si non set)
set -euo pipefail

PROSPECTION_URL="${PROSPECTION_URL:-https://prospection.staging.veridian.site}"
REPO_HOST="${REPO_HOST:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "── E2E flows mail contre $PROSPECTION_URL ──"

# Pré-check : staging répond
if ! curl -sf -o /dev/null "${PROSPECTION_URL}/api/health"; then
  echo "::error::$PROSPECTION_URL /api/health KO — abort"
  exit 1
fi
echo "✓ Staging UP"

# Pré-check : mailpit container sur dev-pub. Si absent, on le démarre.
MAILPIT_STATUS=$(ssh dev-pub 'docker inspect -f "{{.State.Status}}" mailpit-staging 2>/dev/null || echo absent')
if [ "$MAILPIT_STATUS" != "running" ]; then
  echo "ℹ mailpit-staging absent — démarrage du container"
  ssh dev-pub 'docker rm -f mailpit-staging 2>/dev/null || true; \
    docker run -d \
      --name mailpit-staging \
      --network staging-edge \
      --restart unless-stopped \
      -l "traefik.enable=true" \
      -l "traefik.docker.network=staging-edge" \
      -l "traefik.http.routers.mailpit.rule=Host(\`mailpit.staging.veridian.site\`)" \
      -l "traefik.http.routers.mailpit.entrypoints=websecure" \
      -l "traefik.http.routers.mailpit.tls.certresolver=letsencrypt" \
      -l "traefik.http.services.mailpit.loadbalancer.server.port=8025" \
      axllent/mailpit:latest'
  sleep 3
fi
# Vérification que mailpit répond bien depuis le réseau staging-edge.
if ! ssh dev-pub 'docker run --rm --network staging-edge alpine:latest wget -q -O- http://mailpit-staging:8025/api/v1/info' > /dev/null 2>&1; then
  echo "::error::mailpit-staging ne répond pas sur le réseau staging-edge"
  exit 1
fi
echo "✓ mailpit-staging UP (1025 SMTP, 8025 HTTP)"

# Auto-fetch DATABASE_URL depuis le container staging si non fourni.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ℹ Récupération DATABASE_URL depuis prospection-staging"
  DATABASE_URL=$(ssh dev-pub 'docker exec prospection-staging-prospection-1 env 2>/dev/null | grep -E "^DATABASE_URL=" | head -1 | cut -d= -f2-' || true)
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "::error::DATABASE_URL introuvable — exigée pour seed canonique + asserts Prisma"
  exit 1
fi
echo "✓ DATABASE_URL résolue"

# Synchronise le repo courant vers dev-pub.
RUNNER_DIR="/home/ubuntu/agent-V-mail-flows-runner"
echo "── Sync $REPO_HOST → dev-pub:$RUNNER_DIR ──"
ssh dev-pub "mkdir -p $RUNNER_DIR"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'test-results' \
  --exclude 'playwright-report' \
  --exclude 'open-data' \
  "$REPO_HOST/" "dev-pub:$RUNNER_DIR/"

# Lance Playwright dans un container sur staging-edge.
echo "── Run Playwright (chromium headless, 1 worker) ──"
set +e
ssh dev-pub bash -s <<EOF
set -euo pipefail
docker run --rm \\
  --name prosp-mail-flows-\$(date +%s) \\
  --network staging-edge \\
  -v $RUNNER_DIR:/app \\
  -w /app \\
  -e PROSPECTION_URL='$PROSPECTION_URL' \\
  -e DATABASE_URL='$DATABASE_URL' \\
  -e MAILPIT_HTTP_URL='http://mailpit-staging:8025' \\
  -e MAILPIT_SMTP_HOST='mailpit-staging' \\
  -e MAILPIT_SMTP_PORT='1025' \\
  -e CI=1 \\
  mcr.microsoft.com/playwright:v1.60.0-jammy \\
  bash -lc '
    npm ci --silent --no-audit --no-fund 2>&1 | tail -5
    npx prisma generate >/dev/null 2>&1 || true
    npx playwright test --config=playwright.flows-mail.config.ts
  '
EOF
EXIT=$?
set -e

echo
if [ "$EXIT" = "0" ]; then
  echo "✓✓✓ E2E flows mail OK — 5/5 verts ✓✓✓"
else
  echo "✗✗✗ E2E flows mail FAIL — voir test-results/ + e2e-flows-mail.json ✗✗✗"
fi
exit "$EXIT"
