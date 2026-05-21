#!/usr/bin/env bash
#
# check-env-sync.sh — Sync ENV vars entre code, .env.example et docker-compose
#
# Refuse le push si :
#   1. Une `process.env.X` est utilisée dans src/ MAIS absente à la fois
#      de .env.example ET des fichiers infra/docker-compose*.yml
#      → Risque : nouveau dev déploie sans la var → app crash ou tourne
#        en mode dégradé silencieux.
#
# Warning (non bloquant) :
#   2. Une var déclarée dans .env.example n'est plus utilisée dans le code
#      → dette de doc, à clean.
#
# Coût : ~1s (grep statique sur src/ + infra/).
#
# Skip d'urgence : SKIP_ENV_SYNC=1 git push (à éviter).
# Mode soft (warning only) : ENV_SYNC_SOFT=1
#
# Allowlist : certaines vars sont injectées par Next.js ou des libs sans
# `process.env.X` explicite (NODE_ENV, PORT, etc.). Listées dans
# ALLOWLIST_NATIVE.
set -euo pipefail

if [ "${SKIP_ENV_SYNC:-0}" = "1" ]; then
  echo "⚠ check-env-sync.sh skipped via SKIP_ENV_SYNC=1"
  exit 0
fi

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

# Vars injectées automatiquement par Next/Node sans déclaration explicite.
# Pas besoin de doc — utilisées via lib (Prisma, Auth.js, Next) qui les lit
# sans qu'on écrive `process.env.X` dans src/.
ALLOWLIST_NATIVE="NODE_ENV PORT HOSTNAME PWD HOME PATH USER CI VERCEL DATABASE_URL NEXTAUTH_URL"

# Vars autorisées à apparaître dans .env.example même si jamais utilisées dans
# src/ — typiquement consommées par config files (next.config.js, prisma/) ou
# par les libs en interne.
ALLOWLIST_DECLARED="DATABASE_URL NEXTAUTH_URL"

# ─── Extraction des vars utilisées dans le code ──────────────────────────────
USED_VARS=$(grep -roE 'process\.env\.[A-Z][A-Z0-9_]+' src/ 2>/dev/null \
  | grep -oE '[A-Z][A-Z0-9_]+$' \
  | sort -u)

if [ -z "$USED_VARS" ]; then
  echo "${GREEN}✓ Aucune process.env.* trouvée dans src/${NC}"
  exit 0
fi

# ─── Extraction des vars déclarées dans .env.example ─────────────────────────
DECLARED_EXAMPLE=""
if [ -f .env.example ]; then
  DECLARED_EXAMPLE=$(grep -E '^[A-Z][A-Z0-9_]+=' .env.example 2>/dev/null \
    | grep -oE '^[A-Z][A-Z0-9_]+' \
    | sort -u)
fi

# ─── Extraction des vars déclarées dans les compose files ────────────────────
DECLARED_COMPOSE=""
if [ -d infra ]; then
  DECLARED_COMPOSE=$(
    {
      # ${VAR_NAME} ou ${VAR_NAME:-default}
      grep -hoE '\$\{[A-Z][A-Z0-9_]+' infra/docker-compose*.yml 2>/dev/null \
        | grep -oE '[A-Z][A-Z0-9_]+$'
      # environment: VAR_NAME: ... (extraction nom avant le `:`)
      grep -hE '^\s+[A-Z][A-Z0-9_]+:' infra/docker-compose*.yml 2>/dev/null \
        | sed -E 's/^\s+([A-Z][A-Z0-9_]+):.*/\1/'
    } | sort -u
  )
fi

DECLARED_ALL=$(printf '%s\n%s\n%s\n' "$DECLARED_EXAMPLE" "$DECLARED_COMPOSE" "$ALLOWLIST_NATIVE" \
  | tr ' ' '\n' | grep -v '^$' | sort -u)

# ─── Diff : vars utilisées mais non déclarées ────────────────────────────────
UNDOCUMENTED=$(comm -23 <(echo "$USED_VARS") <(echo "$DECLARED_ALL"))

# ─── Diff : vars déclarées dans .env.example mais plus utilisées ─────────────
UNUSED=""
if [ -n "$DECLARED_EXAMPLE" ]; then
  ALLOWED_FILTER=$(echo "$ALLOWLIST_DECLARED $ALLOWLIST_NATIVE" | tr ' ' '\n' | sort -u)
  UNUSED=$(comm -23 <(echo "$DECLARED_EXAMPLE") <(echo "$USED_VARS") \
    | comm -23 - <(echo "$ALLOWED_FILTER") \
    | grep -v '^$' || true)
fi

# ─── Verdict ─────────────────────────────────────────────────────────────────
VIOLATIONS=0

if [ -n "$UNDOCUMENTED" ]; then
  COUNT=$(echo "$UNDOCUMENTED" | grep -c . || true)
  echo "${RED}✗ ${COUNT} var(s) ENV utilisées dans src/ MAIS absentes de .env.example ET des compose :${NC}"
  echo "$UNDOCUMENTED" | sed 's/^/  - /'
  echo "${YELLOW}  Fix : ajouter à .env.example avec un commentaire [REQUIRED/OPTIONAL/...]${NC}"
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

if [ -n "$UNUSED" ]; then
  COUNT=$(echo "$UNUSED" | grep -c . || true)
  echo "${YELLOW}⚠ ${COUNT} var(s) ENV documentées dans .env.example mais plus utilisées (dette doc) :${NC}"
  echo "$UNUSED" | sed 's/^/  - /'
  echo "${YELLOW}  Reco : retirer de .env.example (NON BLOQUANT)${NC}"
fi

if [ "$VIOLATIONS" -eq 0 ]; then
  echo "${GREEN}✓ ENV sync OK (code ↔ .env.example ↔ compose)${NC}"
  exit 0
fi

if [ "${ENV_SYNC_SOFT:-0}" = "1" ]; then
  echo "${YELLOW}⚠ ${VIOLATIONS} violation(s) — mode soft, push autorisé${NC}"
  exit 0
fi

echo
echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
echo "${RED}║ PUSH REFUSÉ — ${VIOLATIONS} var(s) ENV non documentée(s)        ║${NC}"
echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
echo "Skip d'urgence : SKIP_ENV_SYNC=1 git push (NE PAS abuser)"
exit 1
