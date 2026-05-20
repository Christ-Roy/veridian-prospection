#!/usr/bin/env bash
# E2E headfull Playwright contre staging.
#
# Exigé §20.6 CI-ARCHITECTURE pour valider une promotion tier 🔴 HAUT.
# Pas dans la CI (trop long+flaky pour bloquer). Outil agent opt-in.
#
# Usage :
#   bash scripts/e2e/staging-full.sh
#   STAGING_URL=https://prospection.app.veridian.site bash scripts/e2e/staging-full.sh  # post-promo prod
#
# Variables :
#   STAGING_URL              = base URL (default https://prospection.staging.veridian.site)
#   STAGING_USER_EMAIL       = robert.brunon@veridian.site
#   STAGING_USER_PASSWORD    = obligatoire, depuis ~/credentials/.all-creds.env
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

export STAGING_URL STAGING_USER_EMAIL STAGING_USER_PASSWORD

# Pré-check : staging répond
echo "── Pré-check $STAGING_URL/api/health ──"
if ! curl -sf -o /dev/null "${STAGING_URL}/api/health"; then
  echo "::error::Staging KO sur /api/health — abort E2E headfull"
  exit 1
fi
echo "✓ Staging UP"

# Lance Playwright headfull. Si pas de $DISPLAY (machine sans X attaché, ou
# session SSH sans X11 forwarding), on encapsule avec xvfb-run pour avoir
# un display virtuel — le navigateur tourne en mode normal (pas headless),
# juste sans écran physique. §20.6 garantit l'isomorphisme avec un humain.
echo
echo "── Playwright headfull (~3-5min) ──"
if [ -n "${DISPLAY:-}" ]; then
  echo "✓ Display existant : $DISPLAY (tu verras le navigateur s'ouvrir)"
  npx playwright test --config=playwright.staging-full.config.ts
else
  echo "ℹ Pas de DISPLAY → xvfb-run (display virtuel)"
  xvfb-run --auto-servernum --server-args='-screen 0 1280x800x24' \
    npx playwright test --config=playwright.staging-full.config.ts
fi

EXIT=$?

echo
if [ "$EXIT" = "0" ]; then
  echo "✓✓✓ E2E HEADFULL OK — tous les journeys passent ✓✓✓"
else
  echo "✗✗✗ E2E HEADFULL FAIL — voir e2e-headfull-staging.json + screenshots dans test-results/ ✗✗✗"
fi

exit "$EXIT"
