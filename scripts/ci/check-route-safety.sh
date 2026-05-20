#!/usr/bin/env bash
#
# check-route-safety.sh — Audit statique des routes API Next.js
#
# Refuse le push si :
#   1. Un `route.ts` appelle `request.json()` SANS try/catch ni Zod safeParse
#      → crash 500 silencieux sur input malformé (OWASP A04 — input validation)
#   2. Un `src/app/api/admin/**/route.ts` n'appelle pas `requireAdmin(`
#      → endpoint admin sans guard côté serveur (CVE-2025-29927 pattern)
#
# Coût : ~1s (grep statique). Pas de réseau, pas de DB.
#
# Skip d'urgence : SKIP_ROUTE_SAFETY=1 git push (à NE JAMAIS utiliser en CI).
# Mode soft (warning only, pas blocking) : ROUTE_SAFETY_SOFT=1
#
set -euo pipefail

if [ "${SKIP_ROUTE_SAFETY:-0}" = "1" ]; then
  echo "⚠ check-route-safety.sh skipped via SKIP_ROUTE_SAFETY=1"
  exit 0
fi

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

VIOLATIONS=0

# ─── Check 1 : request.json() doit être dans try/catch OU précédé par Zod ────
#
# Pattern accepté :
#   - `try { ... await request.json() ... }`
#   - `safeParse(`  (Zod)
#   - `try` ou `catch` ailleurs dans la même fonction (heuristique simple : on
#     vérifie juste que les 20 lignes autour ont au moins un `try` ou un Zod)
#
# Faux positifs possibles : un endpoint qui parse autrement (`request.text()`
# puis `JSON.parse(text)` dans un try) — on accepte pour simplicité.
echo "→ Check 1/2 : route.ts avec request.json() sans try/catch ni Zod"

UNSAFE_ROUTES=""
while IFS= read -r file; do
  # Pas de request.json() = rien à valider
  if ! grep -q "request\.json()" "$file"; then continue; fi
  # Check : try OU safeParse présent dans le fichier
  if grep -qE "(try\s*\{|safeParse\()" "$file"; then continue; fi
  UNSAFE_ROUTES="$UNSAFE_ROUTES$file"$'\n'
done < <(find src/app/api -name "route.ts" -type f 2>/dev/null)

if [ -n "$UNSAFE_ROUTES" ]; then
  COUNT=$(echo "$UNSAFE_ROUTES" | grep -c . || true)
  echo "${RED}✗ $COUNT route(s) parsent request.json() sans try/catch ni Zod safeParse${NC}"
  echo "$UNSAFE_ROUTES" | sed 's/^/  - /'
  echo "${YELLOW}  Fix : wrappe le json() dans try/catch OU utilise schema.safeParse(body)${NC}"
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

# ─── Check 2 : /api/admin/**/route.ts doit appeler requireAdmin( ─────────────
#
# Patterns accepté (n'importe lequel) :
#   - `requireAdmin(`  → helper standard
#   - `auth().*role.*admin`  → check role inline (rare mais OK)
#   - `isAdmin`  → variant
#
# On NE check PAS le middleware Edge seul (CVE-2025-29927) — il faut une vérif
# server-side dans le handler.
echo "→ Check 2/2 : /api/admin/**/route.ts avec guard requireAdmin"

UNGUARDED_ADMIN=""
while IFS= read -r file; do
  if grep -qE "(requireAdmin\(|isAdmin|role.*===.*['\"]admin['\"])" "$file"; then continue; fi
  UNGUARDED_ADMIN="$UNGUARDED_ADMIN$file"$'\n'
done < <(find src/app/api/admin -name "route.ts" -type f 2>/dev/null)

if [ -n "$UNGUARDED_ADMIN" ]; then
  COUNT=$(echo "$UNGUARDED_ADMIN" | grep -c . || true)
  echo "${RED}✗ $COUNT endpoint(s) admin sans guard serveur requireAdmin/isAdmin${NC}"
  echo "$UNGUARDED_ADMIN" | sed 's/^/  - /'
  echo "${YELLOW}  Fix : ajoute \`const r = await requireAdmin(); if (r.error) return r.error;\` en début de handler${NC}"
  echo "${YELLOW}  Référence : CVE-2025-29927 — middleware Edge seul ne suffit pas${NC}"
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

# ─── Verdict ─────────────────────────────────────────────────────────────────
if [ "$VIOLATIONS" -eq 0 ]; then
  echo "${GREEN}✓ Route safety audit OK${NC}"
  exit 0
fi

if [ "${ROUTE_SAFETY_SOFT:-0}" = "1" ]; then
  echo "${YELLOW}⚠ $VIOLATIONS violation(s) — mode soft, push autorisé${NC}"
  echo "${YELLOW}  Désactive ROUTE_SAFETY_SOFT=1 pour bloquer.${NC}"
  exit 0
fi

echo
echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
echo "${RED}║ PUSH REFUSÉ — $VIOLATIONS violation(s) safety route          ║${NC}"
echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
echo "Skip d'urgence : SKIP_ROUTE_SAFETY=1 git push (NE PAS abuser)"
exit 1
