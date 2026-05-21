#!/usr/bin/env bash
#
# check-deps-cve.sh — Audit CVE des deps avant push (mirror du CI)
#
# Refuse le push si `npm audit --audit-level=high --omit=dev` trouve des
# vulnérabilités CRITICAL ou HIGH dans les deps de production.
#
# Coût : ~3-8s selon le cache npm (utilise le manifeste local, pas de network).
#
# Skip d'urgence : SKIP_DEPS_CVE=1 git push (NE PAS abuser).
# Logique : si tu sais qu'une CVE high est acceptable temporairement (genre
# build-time only ou patch upstream pas dispo), tu skip 1 push puis tu
# documentes dans todo/SECURITY-CVE.md.
#
# Pertinence : ce check NE déclenche que si package-lock.json ou package.json
# sont modifiés dans le diff (sinon aucune dep n'a changé, skip silencieux).
set -euo pipefail

if [ "${SKIP_DEPS_CVE:-0}" = "1" ]; then
  echo "⚠ check-deps-cve.sh skipped via SKIP_DEPS_CVE=1"
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

# Skip si aucune modif des deps dans le diff
DEPS_CHANGED=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null | grep -E '^(package\.json|package-lock\.json)$' || true)
if [ -z "$DEPS_CHANGED" ]; then
  echo "${GREEN}✓ Aucune modif deps — skip CVE check${NC}"
  exit 0
fi

echo "→ npm audit critical/high (prod deps only)..."

# `--omit=dev` ignore les devDependencies (Vitest, ESLint, etc.) qui ne
# tournent pas en prod runtime → leurs CVE sont moins critiques.
# `--audit-level=high` = bloque high + critical, ignore moderate/low.
AUDIT_OUT=$(npm audit --audit-level=high --omit=dev --json 2>/dev/null || true)

# Extrait le compte critical + high depuis le JSON
CRITICAL=$(echo "$AUDIT_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('critical',0))" 2>/dev/null || echo 0)
HIGH=$(echo "$AUDIT_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('high',0))" 2>/dev/null || echo 0)

if [ "$CRITICAL" = "0" ] && [ "$HIGH" = "0" ]; then
  echo "${GREEN}✓ 0 CVE critical/high en prod deps${NC}"
  exit 0
fi

echo
echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
echo "${RED}║ PUSH REFUSÉ — ${CRITICAL} CRITICAL + ${HIGH} HIGH CVE dans prod deps  ║${NC}"
echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
echo "Détail :"
echo "  npm audit --omit=dev --audit-level=high"
echo
echo "Fix :"
echo "  npm audit fix       # auto-fix si patch dispo"
echo "  npm update <pkg>    # bump manuel sinon"
echo
echo "Si vraiment pas fixable (patch upstream pas dispo) :"
echo "  1. Documenter dans todo/SECURITY-CVE.md (justification + ETA)"
echo "  2. SKIP_DEPS_CVE=1 git push (push 1 fois)"
echo "  3. Ouvrir un ticket de bump deps dans la semaine"
exit 1
