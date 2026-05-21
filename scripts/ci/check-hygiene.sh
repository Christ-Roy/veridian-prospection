#!/usr/bin/env bash
#
# check-hygiene.sh — Hygiène code pre-push
#
# Vérifie 2 choses :
#   1. Aucun fichier > 1 MB committé (évite repo bloated par screenshots/dumps)
#   2. Warning sur ajouts de `console.log` (risque leak data + pollution logs)
#      → mode WARNING uniquement (pas blocking), informatif.
#
# Skip d'urgence : SKIP_HYGIENE=1 git push
# Pour fichier large légitime : ajouter à .git/info/attributes ou whitelister
# explicitement dans la variable WHITELIST_LARGE_FILES ci-dessous.
set -euo pipefail

if [ "${SKIP_HYGIENE:-0}" = "1" ]; then
  echo "⚠ check-hygiene.sh skipped via SKIP_HYGIENE=1"
  exit 0
fi

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

BASE_REF="${BASE_REF:-origin/$(git rev-parse --abbrev-ref HEAD)}"
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="origin/main"
fi

# ─── Check 1 : fichiers > 1 MB ───────────────────────────────────────────────
MAX_SIZE_BYTES=$((1 * 1024 * 1024)) # 1 MB
LARGE_FILES=""

# Whitelist (chemins git-relatifs autorisés à être gros) : SQL dumps de tests,
# fixtures volumineuses légitimes, etc.
WHITELIST_LARGE_FILES=(
  # "tests/fixtures/big-dump.sql"
)

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue
  # Check whitelist
  for white in "${WHITELIST_LARGE_FILES[@]}"; do
    [ "$file" = "$white" ] && continue 2
  done
  SIZE=$(stat -c%s "$file" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt "$MAX_SIZE_BYTES" ]; then
    SIZE_MB=$(echo "scale=2; $SIZE/1048576" | bc 2>/dev/null || echo "?")
    LARGE_FILES="${LARGE_FILES}  - ${file} (${SIZE_MB} MB)
"
  fi
done < <(
  # Fichiers dans les commits non pushés + fichiers staged uncommit
  {
    git diff --name-only --diff-filter=AM "$BASE_REF"...HEAD 2>/dev/null
    git diff --cached --name-only --diff-filter=AM 2>/dev/null
  } | sort -u
)

VIOLATIONS_BLOCKING=0

if [ -n "$LARGE_FILES" ]; then
  echo "${RED}✗ Fichier(s) > 1 MB détecté(s) dans le diff${NC}"
  echo "$LARGE_FILES"
  echo "${YELLOW}  Si légitime (genre fixture SQL nécessaire), whiteliste dans${NC}"
  echo "${YELLOW}  scripts/ci/check-hygiene.sh:WHITELIST_LARGE_FILES${NC}"
  echo "${YELLOW}  Sinon : retire le fichier, ajoute à .gitignore${NC}"
  VIOLATIONS_BLOCKING=$((VIOLATIONS_BLOCKING + 1))
fi

# ─── Check 2 : nouveaux console.log dans src/ (WARNING seulement) ────────────
# On veut détecter les `console.log` AJOUTÉS dans src/, pas dans les tests.
# console.warn et console.error sont OK (volontaires pour observabilité).
DIFF_PUSHED_LOGS=$(git diff "$BASE_REF"...HEAD --no-color -U0 -- 'src/' 2>/dev/null \
  | grep -E '^\+' | grep -vE '^\+\+\+' \
  | grep -E 'console\.log\(' \
  | grep -v 'pragma: allow console.log' || true)
DIFF_STAGED_LOGS=$(git diff --cached --no-color -U0 -- 'src/' 2>/dev/null \
  | grep -E '^\+' | grep -vE '^\+\+\+' \
  | grep -E 'console\.log\(' \
  | grep -v 'pragma: allow console.log' || true)
DIFF_ADDED_LOGS=$(printf '%s\n%s' "$DIFF_PUSHED_LOGS" "$DIFF_STAGED_LOGS" | grep -v '^$' || true)

if [ -n "$DIFF_ADDED_LOGS" ]; then
  COUNT=$(echo "$DIFF_ADDED_LOGS" | grep -c . || true)
  echo "${YELLOW}⚠ ${COUNT} nouveau(x) console.log dans src/ — risque pollution logs + leak data${NC}"
  echo "$DIFF_ADDED_LOGS" | head -5 | sed 's/^/    /'
  if [ "$COUNT" -gt 5 ]; then
    echo "    ... (et $((COUNT - 5)) de plus)"
  fi
  echo "${YELLOW}  Reco : utilise console.warn (cas anormal) ou console.error (erreur).${NC}"
  echo "${YELLOW}  Si console.log volontaire : ajouter // pragma: allow console.log${NC}"
  echo "${YELLOW}  → NON BLOQUANT, informatif seulement.${NC}"
fi

# ─── Verdict ─────────────────────────────────────────────────────────────────
if [ "$VIOLATIONS_BLOCKING" -gt 0 ]; then
  echo
  echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "${RED}║ PUSH REFUSÉ — ${VIOLATIONS_BLOCKING} violation(s) hygiène bloquante       ║${NC}"
  echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo "Skip d'urgence : SKIP_HYGIENE=1 git push"
  exit 1
fi

echo "${GREEN}✓ Hygiène code OK${NC}"
exit 0
