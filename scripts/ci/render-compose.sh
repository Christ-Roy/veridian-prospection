#!/usr/bin/env bash
# render-compose.sh — Génère le compose consolidé pour Dokploy
#
# Pourquoi : Dokploy lit un seul fichier docker-compose. On veut rester DRY
# avec docker-compose.base.yml + override (prod|staging) mais aussi fournir
# à Dokploy un fichier auto-suffisant.
#
# Usage :
#   ./scripts/ci/render-compose.sh prod      # → infra/docker-compose.yml
#   ./scripts/ci/render-compose.sh staging   # → infra/docker-compose.staging.rendered.yml
#   ./scripts/ci/render-compose.sh check     # → vérifie que infra/docker-compose.yml
#                                              est en sync avec base+prod (CI guard)
#
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

INFRA=infra
BASE="$INFRA/docker-compose.base.yml"
PROD="$INFRA/docker-compose.prod.yml"
STAGING="$INFRA/docker-compose.staging.yml"
PROD_OUT="$INFRA/docker-compose.yml"

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

render() {
  local env="$1"
  local out="$2"
  local override
  case "$env" in
    prod)    override="$PROD" ;;
    staging) override="$STAGING" ;;
    *) echo "${RED}env inconnu : $env${NC}"; exit 2 ;;
  esac

  # `compose config` résout les overrides, ENV, anchors, et produit un YAML canonique.
  # On le pré-process pour retirer le bloc `name:` injecté (Dokploy gère le projet name lui-même).
  docker compose -f "$BASE" -f "$override" config --no-interpolate 2>/dev/null \
    | grep -v '^name:' \
    > "$out.tmp"

  # Header standard à coller en tête du fichier généré
  {
    echo "# AUTO-GÉNÉRÉ — ne pas éditer à la main."
    echo "# Source : docker-compose.base.yml + docker-compose.${env}.yml"
    echo "# Régénération : ./scripts/ci/render-compose.sh ${env}"
    echo "#"
    cat "$out.tmp"
  } > "$out"
  rm "$out.tmp"

  echo "${GREEN}✓ Généré : $out (depuis base + $env)${NC}"
}

check() {
  # Vérifie que docker-compose.yml versionné == ce qui serait généré.
  # Si désync : la CI rejette (quelqu'un a édité le consolidé à la main).
  render prod "$PROD_OUT" >/dev/null
  # Recompare le fichier maintenant régénéré au contenu staged dans git
  if git diff --quiet -- "$PROD_OUT"; then
    echo "${GREEN}✓ $PROD_OUT en sync avec base + prod${NC}"
    return 0
  fi
  echo "${RED}✗ $PROD_OUT DÉSYNC avec base + prod.${NC}"
  echo "  Quelqu'un a édité directement le fichier consolidé."
  echo "  Fix : modifier base.yml ou prod.yml puis lancer :"
  echo "    ./scripts/ci/render-compose.sh prod"
  echo
  echo "  Diff actuel :"
  git --no-pager diff -- "$PROD_OUT" | head -40
  exit 1
}

case "${1:-}" in
  prod)    render prod "$PROD_OUT" ;;
  staging) render staging "$INFRA/docker-compose.staging.rendered.yml" ;;
  check)   check ;;
  *)
    echo "Usage : $0 {prod|staging|check}"
    exit 1
    ;;
esac
