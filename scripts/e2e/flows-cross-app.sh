#!/usr/bin/env bash
# E2E flows cross-app — script opt-in.
#
# Lance les 7 specs e2e/flows-cross-app/ via un container Playwright
# éphémère sur dev-pub, branché sur le réseau staging-edge. Le
# container voit :
#   - prospection.staging.veridian.site (Traefik) en HTTPS
#   - postgres-staging (DB) en hostname interne
#
# Pourquoi pas en local : les flows exigent un backend Prosp UP +
# une DB réelle. Tourner le tout en local demanderait de provisionner
# une stack complète. Sur dev-pub la stack vit déjà.
#
# Pourquoi pas en CI bloquante : ~5-10 min, dépend du staging UP +
# secret HMAC + DB réelle. Outil agent opt-in, à lancer manuellement
# (ou par un team-lead avant promo) — pattern §20.6 staging-full.
#
# Usage :
#   bash scripts/e2e/flows-cross-app.sh
#   PROSPECTION_URL=https://prospection.staging.veridian.site bash scripts/e2e/flows-cross-app.sh
#
# Variables :
#   PROSPECTION_URL   = URL ciblée (par défaut staging)
#   HUB_API_SECRET    = secret HMAC pour signer provision/credit-leads
#                       (récupéré auto de prospection-staging si non set)
#   DATABASE_URL      = pointer sur LA MÊME DB que PROSPECTION_URL
#                       (récupéré auto de prospection-staging si non set)
set -euo pipefail

PROSPECTION_URL="${PROSPECTION_URL:-https://prospection.staging.veridian.site}"
REPO_HOST="${REPO_HOST:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "── E2E flows cross-app contre $PROSPECTION_URL ──"

# Pré-check : staging répond
if ! curl -sf -o /dev/null "${PROSPECTION_URL}/api/health"; then
  echo "::error::$PROSPECTION_URL /api/health KO — abort"
  exit 1
fi
echo "✓ Staging UP"

# Auto-fetch HUB_API_SECRET + DATABASE_URL depuis le container staging
# si non fournis. Le container Prosp staging porte les bonnes valeurs
# (sécrets partagés Hub↔Prosp + DB postgres-staging interne).
if [ -z "${HUB_API_SECRET:-}" ] || [ -z "${DATABASE_URL:-}" ]; then
  echo "ℹ Récupération HUB_API_SECRET / DATABASE_URL depuis prospection-staging"
  ENV_BLOB=$(ssh dev-pub 'docker exec prospection-staging-prospection-1 env 2>/dev/null | grep -E "^(TENANT_API_SECRET|HUB_API_SECRET|DATABASE_URL)="' || true)
  if [ -z "${HUB_API_SECRET:-}" ]; then
    HUB_API_SECRET=$(echo "$ENV_BLOB" | grep -E '^TENANT_API_SECRET=' | head -1 | cut -d= -f2-)
    HUB_API_SECRET="${HUB_API_SECRET:-$(echo "$ENV_BLOB" | grep -E '^HUB_API_SECRET=' | head -1 | cut -d= -f2-)}"
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    DATABASE_URL=$(echo "$ENV_BLOB" | grep -E '^DATABASE_URL=' | head -1 | cut -d= -f2-)
  fi
fi

if [ -z "${HUB_API_SECRET:-}" ]; then
  echo "::error::HUB_API_SECRET introuvable — passe-le explicitement ou démarre prospection-staging"
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "::error::DATABASE_URL introuvable — exigée pour seed canonique + asserts Prisma"
  exit 1
fi
echo "✓ HUB_API_SECRET (${#HUB_API_SECRET} chars)"
echo "✓ DATABASE_URL résolue"

# Synchronise le repo local courant vers dev-pub (~/agent-T-e2e-flows-runner)
# pour que le container voie le code à jour (sinon il prend
# l'ancien ~/prospection-ui-dev qui peut diverger).
RUNNER_DIR="/home/ubuntu/agent-T-flows-runner"
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

# Lance Playwright dans un container sur staging-edge — le container voit
# postgres-staging par hostname interne et la staging URL via Traefik.
# On installe les deps + exécute la suite via npx playwright test.
echo "── Run Playwright (chromium headless, 1 worker) ──"
set +e
ssh dev-pub bash -s <<EOF
set -euo pipefail
docker run --rm \\
  --name prosp-flows-cross-app-\$(date +%s) \\
  --network staging-edge \\
  -v $RUNNER_DIR:/app \\
  -w /app \\
  -e PROSPECTION_URL='$PROSPECTION_URL' \\
  -e HUB_API_SECRET='$HUB_API_SECRET' \\
  -e TENANT_API_SECRET='$HUB_API_SECRET' \\
  -e DATABASE_URL='$DATABASE_URL' \\
  -e CI=1 \\
  mcr.microsoft.com/playwright:v1.60.0-jammy \\
  bash -lc '
    npm ci --silent --no-audit --no-fund 2>&1 | tail -5
    npx prisma generate >/dev/null 2>&1 || true
    npx playwright test --config=playwright.flows-cross-app.config.ts
  '
EOF
EXIT=$?
set -e

echo
if [ "$EXIT" = "0" ]; then
  echo "✓✓✓ E2E flows cross-app OK — 7/7 verts ✓✓✓"
else
  echo "✗✗✗ E2E flows cross-app FAIL — voir test-results/ + e2e-flows-cross-app.json ✗✗✗"
fi
exit "$EXIT"
