#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# check-sabotage-test.sh — détecte les tests qui ne PROUVENT rien
#
# Pourquoi ce script existe :
#   Un test qui n'assert rien d'observable est inutile, voire dangereux :
#   il fait penser que le code est couvert alors qu'il ne l'est pas. Le
#   bug invitations 2026-05-23 (Supabase mort 5 jours en silence) est l'
#   illustration parfaite : un test mockait fetch Supabase, donc le test
#   passait au vert alors que l'endpoint réel était mort en prod.
#
#   La couverture de lignes (Vitest --coverage) ne détecte PAS ça : si
#   on appelle `myFn()` dans un test mais qu'on n'assert rien sur son
#   résultat, la ligne est marquée couverte. C'est mensonger.
#
#   Sabotage-test : on casse temporairement la source de manière évidente
#   (`return null` à la place de la valeur, inverser un `===`), on relance
#   le test associé. Si le test reste vert, c'est qu'il n'observe rien
#   d'utile → BLOCKING.
#
# Ce que ce script fait :
#   1. Liste les *.test.ts / *.test.tsx modifiés dans le diff vs BASE_REF.
#   2. Pour chaque test, résout le fichier source associé via la
#      convention canonique (colocalisé src/lib/foo.test.ts → src/lib/foo.ts
#      OU __tests__/lib/foo.test.ts → src/lib/foo.ts).
#   3. Lance Vitest sur le test → doit déjà être vert (sinon c'est un test
#      cassé, autre problème, on skip avec warning).
#   4. Sabote la source via UNE des stratégies (essaie dans l'ordre, garde
#      la 1ère qui s'applique) :
#        a) `return X` → `return null` (premier match)
#        b) inversion `===` → `!==` (premier match)
#        c) première fonction exportée → body vidé `return undefined as any;`
#   5. Re-lance Vitest sur le test → DOIT être rouge.
#   6. Restore TOUJOURS le source intact (trap EXIT pour fail-safe).
#   7. Si rouge → OK. Si toujours vert → BLOCKING : le test n'observe rien.
#
# Exit 0 = tous les tests modifiés prouvent qu'ils détectent un bug évident.
# Exit ≠ 0 = au moins un test ne sabote pas → push refusé.
#
# Usage :  scripts/ci/check-sabotage-test.sh
#          SKIP_SABOTAGE_TEST=1 git push   (skip d'urgence — à NE PAS abuser)
#
# Coût : ~1-3s par test modifié (Vitest unit colocalisé est rapide).
#        Le hook ne tourne que sur les *.test.ts modifiés, pas sur toute
#        la suite.
#
# Limitation acceptée : sabotage heuristique (sed), pas AST. Si aucune
# stratégie ne s'applique au source (fichier vide, structure exotique),
# on SKIP le fichier avec WARNING — pas BLOCKING. La couverture de
# l'heuristique sur la code-base actuelle est >90% (cas standards :
# return X, comparaisons ===, fonctions exportées).
#
# Sabotage-testé 2026-05-23 :
#   - Cas SAIN : sabote src/lib/cache.ts (return entry.data → return null)
#     → cache.test.ts rougit (assertion sur la valeur cachée) → exit 0 ✓
#   - Cas DÉTECTÉ : test vide (juste `expect(true).toBe(true)`) → exit 1 ✓
#
# Fail-safe : trap EXIT restaure systématiquement le source, même si
# le script crashe en plein milieu. Mieux un push refusé qu'un fichier
# laissé sabotté sur le worktree.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${SKIP_SABOTAGE_TEST:-0}" = "1" ]; then
  echo "⚠ check-sabotage-test.sh skipped via SKIP_SABOTAGE_TEST=1"
  exit 0
fi

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${BASE_REF:-origin/$(git rev-parse --abbrev-ref HEAD)}"
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="origin/main"
fi

echo "${BLUE}── check-sabotage-test : preuve que les tests détectent ──${NC}"

# ─── Liste des tests modifiés ────────────────────────────────────────────
MODE="committed"
if [ "$BASE_REF" = "HEAD" ]; then
  CHANGED=$( (git diff --name-only HEAD; git diff --cached --name-only) | sort -u | grep -v '^$' || true )
  MODE="working-tree"
else
  CHANGED=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || true)
fi

CHANGED_TESTS=$(echo "$CHANGED" | grep -E '\.test\.(ts|tsx)$' || true)

if [ -z "$CHANGED_TESTS" ]; then
  echo "${GREEN}✓ Aucun test modifié, rien à sabotage-tester${NC}"
  exit 0
fi

# ─── Mapping test → source ───────────────────────────────────────────────
# Convention 1 : colocalisé — src/lib/foo.test.ts → src/lib/foo.ts
# Convention 2 : découplée — __tests__/lib/foo.test.ts → src/lib/foo.ts
#                            __tests__/api/foo/bar.test.ts → src/app/api/foo/bar/route.ts
source_for_test() {
  local t="$1"
  # Cas colocalisé : remplace .test.ts/.tsx par .ts/.tsx, vérifie existence
  local coloc_ts="${t%.test.ts}.ts"
  local coloc_tsx="${t%.test.tsx}.tsx"
  if [ "$t" != "$coloc_ts" ] && [ -f "$coloc_ts" ]; then
    echo "$coloc_ts"; return 0
  fi
  if [ "$t" != "$coloc_tsx" ] && [ -f "$coloc_tsx" ]; then
    echo "$coloc_tsx"; return 0
  fi
  # Cas découplé __tests__/X.test.ts → src/X.ts
  case "$t" in
    __tests__/api/*)
      local rel="${t#__tests__/api/}"
      rel="${rel%.test.ts}"
      local route="src/app/api/${rel}/route.ts"
      [ -f "$route" ] && echo "$route" && return 0
      ;;
    __tests__/lib/*)
      local rel="${t#__tests__/lib/}"
      rel="${rel%.test.ts}"
      local lib="src/lib/${rel}.ts"
      [ -f "$lib" ] && echo "$lib" && return 0
      ;;
    __tests__/components/*)
      local rel="${t#__tests__/components/}"
      rel="${rel%.test.tsx}"
      rel="${rel%.test.ts}"
      local comp_tsx="src/components/${rel}.tsx"
      local comp_ts="src/components/${rel}.ts"
      [ -f "$comp_tsx" ] && echo "$comp_tsx" && return 0
      [ -f "$comp_ts" ]  && echo "$comp_ts"  && return 0
      ;;
    __tests__/hooks/*)
      local rel="${t#__tests__/hooks/}"
      rel="${rel%.test.ts}"
      local h="src/hooks/${rel}.ts"
      [ -f "$h" ] && echo "$h" && return 0
      ;;
  esac
  return 1
}

# ─── Stratégies de sabotage (sed, restaurable) ───────────────────────────
# Retourne 0 si une stratégie a appliqué un changement, 1 sinon. Le caller
# vérifie ensuite avec `diff` que le fichier a bien été modifié.
#
# Stratégie a — premier `return <expr>;` (avec expr non vide ≠ null/void/undefined)
# Stratégie b — premier `===` → `!==`
# Stratégie c — première fonction exportée → body vidé
sabotage_source() {
  local src="$1"
  local before
  before=$(md5sum "$src" | cut -d' ' -f1)

  # Stratégie a : `return X;` → `return null;` (premier match seulement)
  # Évite les `return;` et `return null;` (déjà null) pour ne pas no-op.
  if grep -nE '^\s*return\s+[^;]*[^;\s]\s*;' "$src" | head -1 \
     | grep -vE 'return\s+(null|undefined|void)\b' >/dev/null 2>&1; then
    local lineno
    lineno=$(grep -nE '^\s*return\s+[^;]*[^;\s]\s*;' "$src" \
             | grep -vE 'return\s+(null|undefined|void)\b' \
             | head -1 | cut -d: -f1)
    if [ -n "$lineno" ]; then
      # Remplace la ligne complète par `return null;` en gardant l'indentation
      local indent
      indent=$(sed -n "${lineno}p" "$src" | sed -E 's/^([[:space:]]*).*/\1/')
      sed -i "${lineno}s|.*|${indent}return null;|" "$src"
      local after
      after=$(md5sum "$src" | cut -d' ' -f1)
      if [ "$before" != "$after" ]; then
        echo "    sabotage: ligne $lineno → return null"
        return 0
      fi
    fi
  fi

  # Stratégie b : premier `===` → `!==`
  if grep -nE '===' "$src" | head -1 >/dev/null 2>&1; then
    local lineno
    lineno=$(grep -nE '===' "$src" | head -1 | cut -d: -f1)
    if [ -n "$lineno" ]; then
      sed -i "${lineno}s|===|!==|" "$src"
      local after
      after=$(md5sum "$src" | cut -d' ' -f1)
      if [ "$before" != "$after" ]; then
        echo "    sabotage: ligne $lineno → === devient !=="
        return 0
      fi
    fi
  fi

  # Stratégie c : première fonction exportée → vidée
  # `export function foo(...) { ... }` → on remplace par
  # `export function foo(...): any { return undefined as any; }`
  # Heuristique simple : on injecte `return undefined as any;` juste après
  # la première `{` de la première `export function ...` rencontrée.
  if grep -nE '^\s*export\s+(async\s+)?function\s+\w+\s*\(' "$src" | head -1 >/dev/null 2>&1; then
    local lineno
    lineno=$(grep -nE '^\s*export\s+(async\s+)?function\s+\w+\s*\(' "$src" | head -1 | cut -d: -f1)
    if [ -n "$lineno" ]; then
      # Cherche la ligne du `{` à partir de lineno (souvent la même ou la suivante)
      local brace_line
      brace_line=$(awk -v start="$lineno" 'NR>=start && /\{/ {print NR; exit}' "$src")
      if [ -n "$brace_line" ]; then
        # Insère après le `{` une ligne `return undefined as any;`
        sed -i "${brace_line}a\\  return undefined as any;" "$src"
        local after
        after=$(md5sum "$src" | cut -d' ' -f1)
        if [ "$before" != "$after" ]; then
          echo "    sabotage: ligne $brace_line → première fonction exportée court-circuitée"
          return 0
        fi
      fi
    fi
  fi

  return 1
}

# ─── Boucle principale ──────────────────────────────────────────────────
FAILED=0
SKIPPED=0
OK=0

# Variables d'état pour le trap EXIT (restore systématique)
CURRENT_SRC=""
CURRENT_BACKUP=""

cleanup_sabotage() {
  if [ -n "${CURRENT_BACKUP:-}" ] && [ -f "${CURRENT_BACKUP:-}" ]; then
    if [ -n "${CURRENT_SRC:-}" ]; then
      cp "$CURRENT_BACKUP" "$CURRENT_SRC" 2>/dev/null || true
    fi
    rm -f "$CURRENT_BACKUP" 2>/dev/null || true
  fi
  CURRENT_SRC=""
  CURRENT_BACKUP=""
}
trap cleanup_sabotage EXIT

for t in $CHANGED_TESTS; do
  [ ! -f "$t" ] && continue  # supprimé

  # Résoudre la source
  if ! src=$(source_for_test "$t" 2>/dev/null); then
    echo "${YELLOW}⚠ $t : source associée introuvable (mapping canonique) — skip${NC}"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Vitest run du test seul (timeout 60s par sécurité)
  echo "  → ${BLUE}$t${NC} → $src"
  TEST_LOG="/tmp/sabotage-test-$$.log"
  if ! timeout 60 npx vitest run "$t" >"$TEST_LOG" 2>&1; then
    echo "${YELLOW}  ⚠ $t déjà rouge AVANT sabotage — c'est un test cassé, autre problème${NC}"
    rm -f "$TEST_LOG"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  rm -f "$TEST_LOG"

  # ── Skip tests source-level (anti-faux-positif 2026-05-23, durci 2026-05-24) ──
  # Un test "source-level" lit le fichier source en texte et asserte sur
  # son contenu (ex: `expect(source).toMatch(/...regex.../)` ou
  # `source.match(/.../)`). C'est un pattern valide et reproductible
  # (cf settings-reference.test.tsx, sans-site-sidebar.test.tsx,
  # app-nav.test.tsx, prospects-tech-debt-sort.test.ts — convention repo).
  #
  # Le sabotage runtime (sed sur le source pour casser une valeur de
  # retour) NE CHANGE PAS le contenu textuel des regex que le test
  # cherche → le test reste vert même après sabotage. C'est un faux
  # positif inhérent au pattern source-level, pas un défaut du test.
  #
  # Détection (l'un des deux suffit) :
  #   - lecture FS  : `fs.readFile`, `fs.readFileSync`, ou `readFileSync` /
  #                   `readFile` importés via `from "fs"` ou `from "node:fs"`
  #   - assertion source : `expect(<id>).toMatch(...)`,
  #                        `<id>.match(...)`, `<id>.toContain(...)` ou
  #                        `<id>.includes(...)` sur le texte source lu
  #
  # Cf ticket todo/done/2026-05-24-husky-faux-positif-sabotage-source-level-tests.md
  # (Agent I 2026-05-23 — 1/11 tests faux-positif sur sabotage muté).
  reads_source=0
  if grep -qE 'fs\.readFile|readFileSync\(|readFile\(' "$t" \
     || grep -qE 'from "(node:)?fs"' "$t"; then
    reads_source=1
  fi
  asserts_on_source=0
  if grep -qE 'expect\([a-zA-Z_][a-zA-Z0-9_]*\)\.toMatch' "$t" \
     || grep -qE '\b(source|src|sourceCode|code|content|text)\.(match|toContain|includes)\(' "$t"; then
    asserts_on_source=1
  fi
  if [ "$reads_source" = "1" ] && [ "$asserts_on_source" = "1" ]; then
    echo "${YELLOW}  ⚠ $t est un test source-level (lecture fs + assertion textuelle) — skip sabotage runtime${NC}"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Backup + sabotage
  CURRENT_SRC="$src"
  CURRENT_BACKUP="/tmp/sabotage-backup-$$-$(basename "$src")"
  cp "$src" "$CURRENT_BACKUP"

  if ! sabotage_source "$src"; then
    echo "${YELLOW}  ⚠ aucune stratégie de sabotage applicable sur $src — skip${NC}"
    cleanup_sabotage
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Re-run Vitest, DOIT être rouge
  TEST_LOG="/tmp/sabotage-test-$$.log"
  set +e
  timeout 60 npx vitest run "$t" >"$TEST_LOG" 2>&1
  SABO_EXIT=$?
  set -e

  # Restore TOUJOURS avant de juger
  cleanup_sabotage

  if [ "$SABO_EXIT" -eq 0 ]; then
    echo "${RED}  ✗ $t reste VERT après sabotage de $src${NC}"
    echo "${RED}    Le test n'observe rien d'utile — il valide quoi exactement ?${NC}"
    echo "${YELLOW}    Pattern typique : appelle la fonction sans assert sur le résultat,${NC}"
    echo "${YELLOW}    ou mock la dep et assert sur le mock plutôt que sur le retour réel.${NC}"
    rm -f "$TEST_LOG"
    FAILED=$((FAILED + 1))
    continue
  fi

  rm -f "$TEST_LOG"
  echo "${GREEN}  ✓ rouge après sabotage — le test détecte vraiment${NC}"
  OK=$((OK + 1))
done

# ─── Verdict ────────────────────────────────────────────────────────────
echo
echo "${BLUE}── récap sabotage : $OK ok / $SKIPPED skip / $FAILED fail ──${NC}"

if [ "$FAILED" -gt 0 ]; then
  echo
  echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "${RED}║ PUSH REFUSÉ — $FAILED test(s) ne détecte(nt) rien            ║${NC}"
  echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo "Fix : ajoute des assertions sur le RETOUR réel de la fonction"
  echo "(pas juste sur les mocks). Cf bug invitations 2026-05-23."
  echo
  echo "Skip d'urgence (à JAMAIS faire en CI) : SKIP_SABOTAGE_TEST=1 git push"
  exit 1
fi

echo "${GREEN}✓ Tous les tests modifiés prouvent qu'ils détectent un sabotage${NC}"
exit 0
