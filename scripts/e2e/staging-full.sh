#!/usr/bin/env bash
# E2E headfull Playwright contre staging.
#
# Exigé §20.6 CI-ARCHITECTURE pour valider une promotion tier 🔴 HAUT.
# Pas dans la CI (trop long+flaky pour bloquer). Outil agent opt-in.
#
# MODE PAR DÉFAUT = WRAPPER DEV-PUB (depuis 2026-05-25, ticket
# mega-battery-doit-tourner-sur-devpub) :
#   - Le helper Auth.js v5 (e2e/helpers/auth.ts) fait un `prisma.user.upsert()`
#     direct contre PostgreSQL. Depuis la migration Nomad, la DB et l'app
#     partagent le même namespace CNI et DATABASE_URL pointe sur 127.0.0.1.
#   - On wrap donc tout dans un container Playwright lancé sur dev-pub,
#     joint au namespace réseau privé de l'allocation Nomad. Le script :
#       1. Résout le container de la task Nomad `prospection` active.
#       2. Récupère DATABASE_URL sans l'afficher et identifie son namespace.
#       3. Rsync le code local vers /tmp/prosp-megabattery sur dev-pub.
#       4. Lance Playwright dans ce namespace, puis récupère le rapport JSON.
#
# Usage :
#   bash scripts/e2e/staging-full.sh                                # mode dev-pub (défaut)
#   STAGING_URL=https://prospection.app.veridian.site bash ...      # post-promo prod
#   LOCAL_E2E=1 bash scripts/e2e/staging-full.sh                    # rétro-compat local
#
# Variables :
#   STAGING_URL              = base URL (default https://prospection.staging.veridian.site)
#   STAGING_USER_EMAIL       = robert.brunon@veridian.site
#   STAGING_USER_PASSWORD    = obligatoire, depuis ~/credentials/.all-creds.env
#   DATABASE_URL             = exigé par helper Auth.js v5 (seed user canonique).
#                              Auto-récupéré via SSH dev-pub si absent.
#   LOCAL_E2E=1              = skip le wrap dev-pub (anciens flows, debug 1 spec, etc.)
set -euo pipefail

STAGING_URL="${STAGING_URL:-https://prospection.staging.veridian.site}"

# Source les credentials Veridian si dispo. Parser grep + eval pour
# tolérer les valeurs avec espaces/apostrophes (le `source` direct plante
# sur les lignes avec des valeurs non quotées contenant des caractères
# spéciaux — observé sur .all-creds.env ligne 49).
if [ -f "$HOME/credentials/.all-creds.env" ]; then
  if [ -z "${STAGING_USER_EMAIL:-}" ]; then
    STAGING_USER_EMAIL=$(grep -E '^ROBERT_BASIC_AUTH_EMAIL=' "$HOME/credentials/.all-creds.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
  if [ -z "${STAGING_USER_PASSWORD:-}" ]; then
    STAGING_USER_PASSWORD=$(grep -E '^ROBERT_BASIC_AUTH_PASSWORD=' "$HOME/credentials/.all-creds.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
fi

if [ -z "${STAGING_USER_PASSWORD:-}" ]; then
  echo "::error::STAGING_USER_PASSWORD manquant — exigé pour login"
  echo "Source : ~/credentials/.all-creds.env (ROBERT_BASIC_AUTH_PASSWORD)"
  exit 1
fi

# Auto-détecte le secret HMAC selon l'URL cible. Permet de run le E2E SSO
# Hub→Prosp contre n'importe quel environnement sans configurer manuellement.
if [[ "$STAGING_URL" == *"app.veridian.site"* ]] && [ -z "${PROD_HUB_API_SECRET:-}" ]; then
  echo "ℹ Cible PROD — récupère le secret HMAC depuis le container prod via SSH"
  PROD_HUB_API_SECRET=$(ssh prod-pub 'docker exec compose-connect-redundant-firewall-l5fmki-prospection-1 env 2>/dev/null | grep -E "^(PROSPECTION_HUB_API_SECRET|TENANT_API_SECRET)=" | head -1 | cut -d= -f2-' 2>/dev/null || echo "")
  if [ -n "$PROD_HUB_API_SECRET" ]; then
    export PROD_HUB_API_SECRET
    echo "✓ PROD_HUB_API_SECRET récupéré (${#PROD_HUB_API_SECRET} chars)"
  else
    echo "⚠ Impossible de récupérer le secret prod — test SSO sera skippé"
  fi
fi

# DATABASE_URL exigé par e2e/helpers/auth.ts (Auth.js v5 seed user
# canonique via Prisma upsert avant login). Sans, 50+ specs fail
# avec "DATABASE_URL absent — impossible de seeder le compte canonique".
# Cf todo/done/2026-05-25-script-staging-full-database-url-manquant.md
resolve_staging_container() {
  ssh dev-pub \
    'docker ps --filter "label=com.hashicorp.nomad.alloc_id" --format "{{.ID}} {{.Names}}" | grep -E "^[0-9a-f]+ prospection-[0-9a-f-]+$" | head -1 | cut -d" " -f1' \
    2>/dev/null || true
}

PROSP_STAGING_CONTAINER=""

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ℹ DATABASE_URL absent, récupération depuis la task Nomad staging"
  PROSP_STAGING_CONTAINER=$(resolve_staging_container)
  if [ -z "$PROSP_STAGING_CONTAINER" ]; then
    echo "::error::Task Nomad Prospection staging introuvable sur dev-pub"
    echo "Vérifie : nomad-v allocs prospection-staging"
    exit 1
  fi
  DATABASE_URL=$(ssh dev-pub "docker exec ${PROSP_STAGING_CONTAINER} env 2>/dev/null | grep -E '^DATABASE_URL=' | head -1 | cut -d= -f2-" 2>/dev/null || echo "")
  if [ -z "$DATABASE_URL" ]; then
    echo "::error::DATABASE_URL introuvable dans le container ${PROSP_STAGING_CONTAINER}"
    echo "Le helper Auth.js v5 (e2e/helpers/auth.ts) en a besoin pour seeder le compte canonique."
    exit 1
  fi
  echo "✓ DATABASE_URL récupéré via SSH (${#DATABASE_URL} chars)"
fi

export STAGING_URL STAGING_USER_EMAIL STAGING_USER_PASSWORD DATABASE_URL

# Pré-check : staging répond
echo "── Pré-check $STAGING_URL/api/health ──"
if ! curl -sf -o /dev/null "${STAGING_URL}/api/health"; then
  echo "::error::Staging KO sur /api/health — abort E2E headfull"
  exit 1
fi
echo "✓ Staging UP"

###############################################################################
# MODE LOCAL (LOCAL_E2E=1) — rétro-compat : lance Playwright sur la machine
# locale Robert. Utilisé pour debug 1 spec ciblée ou contre une URL accessible
# sans Prisma direct. La mega battery complète ÉCHOUERA ici si elle a besoin
# du seed Prisma car postgres-staging n'est pas résolvable.
###############################################################################
if [ "${LOCAL_E2E:-0}" = "1" ]; then
  echo
  echo "── Mode LOCAL_E2E=1 (rétro-compat) — Playwright sur la machine locale ──"
  if [ -n "${DISPLAY:-}" ]; then
    echo "✓ Display existant : $DISPLAY (tu verras le navigateur s'ouvrir)"
    npx playwright test --config=playwright.staging-full.config.ts
  else
    echo "ℹ Pas de DISPLAY → xvfb-run (display virtuel)"
    xvfb-run --auto-servernum --server-args='-screen 0 1280x800x24' \
      npx playwright test --config=playwright.staging-full.config.ts
  fi
  exit $?
fi

if [ -z "$PROSP_STAGING_CONTAINER" ]; then
  PROSP_STAGING_CONTAINER=$(resolve_staging_container)
fi
if [ -z "$PROSP_STAGING_CONTAINER" ]; then
  echo "::error::Task Nomad Prospection staging introuvable sur dev-pub"
  echo "Vérifie : nomad-v allocs prospection-staging"
  exit 1
fi

PLAYWRIGHT_NETWORK=$(ssh dev-pub \
  "docker inspect ${PROSP_STAGING_CONTAINER} --format '{{.HostConfig.NetworkMode}}'" \
  2>/dev/null || echo "")
if [[ "$PLAYWRIGHT_NETWORK" != container:* ]]; then
  echo "::error::Namespace réseau Nomad introuvable pour ${PROSP_STAGING_CONTAINER}"
  exit 1
fi

###############################################################################
# MODE DEV-PUB (défaut) — wrap dans container Playwright sur dev-pub.
###############################################################################

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_DIR="/tmp/prosp-megabattery"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.60.0-jammy"
LOCAL_REPORT="${REPO_ROOT}/e2e-headfull-staging.json"

echo
echo "── Mode wrapper dev-pub (défaut) ──"
echo "  Repo local       : ${REPO_ROOT}"
echo "  Remote dev-pub   : dev-pub:${REMOTE_DIR}"
echo "  Image            : ${PLAYWRIGHT_IMAGE}"
echo "  Réseau Docker    : namespace Nomad privé"
echo

# 1. Préparer le remote dir et sync le code
echo "── Sync code → dev-pub:${REMOTE_DIR} ──"
ssh dev-pub "rm -rf ${REMOTE_DIR}/node_modules ${REMOTE_DIR}/test-results 2>/dev/null || true; mkdir -p ${REMOTE_DIR}"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude test-results \
  --exclude .git \
  --exclude '.env*' \
  --exclude '.claude/worktrees' \
  --exclude 'e2e-headfull-staging.json' \
  --exclude 'playwright-report' \
  "${REPO_ROOT}/" "dev-pub:${REMOTE_DIR}/"
echo "✓ Code synchronisé"

# 2. Construire le bloc d'env vars à passer au container
#    On les écrit dans un fichier sur dev-pub pour éviter les soucis
#    d'échappement de quotes/backticks dans l'arg `docker run -e`.
#    Note : DATABASE_URL contient souvent `?schema=public&...` avec des
#    caractères spéciaux — fichier env via --env-file = robuste.
ENV_FILE_REMOTE="${REMOTE_DIR}/.megabattery.env"
cleanup_remote_env() {
  ssh dev-pub "rm -f ${ENV_FILE_REMOTE}" >/dev/null 2>&1 || true
}
trap cleanup_remote_env EXIT INT TERM

ssh dev-pub "umask 077; cat > ${ENV_FILE_REMOTE}" <<EOF
STAGING_URL=${STAGING_URL}
PROSPECTION_URL=${STAGING_URL}
STAGING_USER_EMAIL=${STAGING_USER_EMAIL}
STAGING_USER_PASSWORD=${STAGING_USER_PASSWORD}
DATABASE_URL=${DATABASE_URL}
PROD_HUB_API_SECRET=${PROD_HUB_API_SECRET:-}
PLAYWRIGHT_TEST_ARGS=${PLAYWRIGHT_TEST_ARGS:-}
CI=1
HEADED=1
EOF
ssh dev-pub "chmod 600 ${ENV_FILE_REMOTE}"

# 3. Lance le container Playwright
#    - --network container:*  → partage le namespace CNI Nomad ; la DB
#                               reste privée sur 127.0.0.1:5432
#    - --env-file              → injecte STAGING_URL/DATABASE_URL/etc.
#    - le helper run-headfull-container.sh installe les dépendances, démarre
#      Xvfb avec un readiness check explicite, puis lance Playwright headfull
echo
echo "── docker run Playwright sur dev-pub (~5-10 min, npm ci + tests) ──"
set +e
ssh dev-pub "docker run --rm \
  --network ${PLAYWRIGHT_NETWORK} \
  --env-file ${ENV_FILE_REMOTE} \
  -v ${REMOTE_DIR}:/work \
  -w /work \
  ${PLAYWRIGHT_IMAGE} \
  bash scripts/e2e/run-headfull-container.sh"
EXIT=$?
set -e

# 4. Récupère le rapport JSON (même si exit != 0 — utile pour diagnostic)
echo
echo "── Récup rapport JSON ──"
if ssh dev-pub "test -f ${REMOTE_DIR}/e2e-headfull-staging.json"; then
  scp -q "dev-pub:${REMOTE_DIR}/e2e-headfull-staging.json" "${LOCAL_REPORT}" || true
  echo "✓ Rapport : ${LOCAL_REPORT}"
else
  echo "⚠ Pas de rapport JSON sur dev-pub (test n'a peut-être pas tourné)"
fi

# 5. Cleanup minimal : on garde le code synchro pour debug (rsync écrasera
#    au prochain run). On retire juste le fichier env (contient le password).
cleanup_remote_env
trap - EXIT INT TERM

echo
if [ "$EXIT" = "0" ]; then
  echo "✓✓✓ E2E HEADFULL OK — tous les journeys passent ✓✓✓"
else
  echo "✗✗✗ E2E HEADFULL FAIL — exit=${EXIT}, voir ${LOCAL_REPORT} ✗✗✗"
  echo "    Logs/screenshots Playwright : dev-pub:${REMOTE_DIR}/test-results/"
fi

exit "$EXIT"
