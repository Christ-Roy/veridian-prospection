#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# check-typecheck-lint.sh — garde-fou local TS strict + ESLint
#
# Pourquoi ce script existe (incidents 2026-05-23) :
#   3 yo-yo CI quality gate consécutifs dans la même session, tous des
#   erreurs TS strict / ESLint qui passent Vitest LOCAL (qui transpile en
#   permissif via tsx) mais cassent en CI (tsc --noEmit + eslint strict).
#
#   - 01233a6 : TS18048 'result.error possibly undefined' (4 occurrences)
#   - ba71dd9 : @typescript-eslint/no-unused-vars (4 occurrences)
#   - 6450f55 : TS2352 'cast may be a mistake' (effet de bord du fix #2)
#
#   Pattern : agent écrit un test, Vitest local vert, push, CI rouge, fix,
#   push, CI rouge sur un autre lint, fix, push, etc. 3 push pour 1 test
#   livré. Le hook pre-push doit attraper ÇA pour casser le cycle.
#
# Ce que ce script vérifie — rapide (~15-30s sur cache npm) :
#   1. `npx tsc --noEmit` sur tout le projet → identique à la CI
#   2. `npx eslint src/ __tests__/` --quiet → identique à la CI
#
# Exit 0 = OK pour push. Exit ≠ 0 = bloque le push, montre exactement
# ce que la CI va dire.
#
# Coût : ~15-30s wall-clock sur warm cache npm. Acceptable parce qu'on
# évite un yo-yo CI complet (build Docker + deploy + smoke = ~7-10min).
#
# Skip d'urgence : SKIP_TYPECHECK_LINT=1 git push (à NE JAMAIS faire en CI).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "${RED}✗ $1${NC}"; exit 1; }
ok()   { echo "${GREEN}✓ $1${NC}"; }

echo "${BLUE}── check-typecheck-lint : tsc --noEmit + eslint (mirror CI) ──${NC}"

# ── 1. tsc --noEmit ──────────────────────────────────────────────────────
echo "  tsc --noEmit…"
if ! npx tsc --noEmit > /tmp/tsc-output.log 2>&1; then
  echo "${RED}--- tsc --noEmit a échoué : ---${NC}"
  grep "error TS" /tmp/tsc-output.log | head -20
  fail "tsc rejette le diff — corrige avant de pousser (la CI le rejettera aussi)"
fi
ok "tsc --noEmit passe"

# ── 2. eslint src/ + __tests__/ ──────────────────────────────────────────
echo "  eslint src/ __tests__/ --quiet…"
if ! npx eslint src/ __tests__/ --quiet > /tmp/eslint-output.log 2>&1; then
  echo "${RED}--- eslint a échoué : ---${NC}"
  cat /tmp/eslint-output.log | head -30
  fail "eslint rejette le diff — corrige avant de pousser (la CI le rejettera aussi)"
fi
ok "eslint src/ __tests__/ passe"

echo "${GREEN}── check-typecheck-lint : tsc + eslint OK, prêt pour CI ──${NC}"
exit 0
