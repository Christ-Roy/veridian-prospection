#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# check-prisma-drift.sh — détecte le drift schéma DB ↔ schema.prisma
#
# Pourquoi ce script existe :
#   `schema.prisma` est censé être la source de vérité du schéma DB.
#   En réalité, plusieurs tables (results, segment_catalog, before_enrich,
#   staging_*) existent dans la DB prod Prospection mais ne sont pas
#   déclarées dans schema.prisma — résultat : on touche au schéma sans
#   le savoir, on lance des migrations qui ignorent ces tables, et le
#   modèle mental dev diverge du schéma réel. Ticket P5 ouvert
#   2026-05-22 sur ce sujet, et probablement d'autres à venir si on ne
#   ferme pas la boucle.
#
#   Ce script lance `prisma db pull` contre une DB de référence (staging)
#   et compare le résultat à schema.prisma. Si la DB a des choses en plus,
#   on warne (pas encore BLOCKING — v1, on observe avant de durcir).
#
# Ce que ce script fait :
#   1. Ne tourne que si le diff touche prisma/schema.prisma OU
#      prisma/migrations/ (sinon c'est inutile, le schéma local n'a pas
#      bougé donc le check ne change rien).
#   2. Cherche une DB de référence dans cet ordre :
#        a) PRISMA_DRIFT_DATABASE_URL (override explicite, prioritaire)
#        b) DATABASE_URL_STAGING (convention CI)
#      Si aucune n'est fournie → WARN+SKIP (pas BLOCKING). Le check tourne
#      en CI où l'URL est injectée ; en local sans accès direct à la DB
#      staging, on laisse passer.
#   3. Lance `prisma db pull --print --schema /tmp/pulled.prisma` contre
#      la DB de référence.
#   4. Diffuse les MODELS déclarés des deux côtés (un model présent dans
#      la DB mais pas dans schema.prisma = drift). On normalise pour
#      ignorer l'ordre, les commentaires, les whitespaces.
#   5. WARN sur chaque drift détecté (v1).
#
# Exit 0 = OK (pas de drift, ou check skippé faute d'URL).
# Exit ≠ 0 = uniquement si erreur d'invocation Prisma (incident technique).
#            Le drift seul n'est PAS bloquant en v1 — observation seulement.
#
# Usage :
#   scripts/ci/check-prisma-drift.sh
#   PRISMA_DRIFT_DATABASE_URL=postgresql://… scripts/ci/check-prisma-drift.sh
#   SKIP_PRISMA_DRIFT=1 git push                (skip d'urgence)
#
# Coût : 5-15s (prisma db pull est lent sur grosse DB ; sur Prospection
#        ~1M entreprises, le pull est encore raisonnable car il introspecte
#        le schéma sans lire les rows).
#
# Limitation acceptée :
#   - Nécessite une DB accessible — sinon SKIP. Le check sert surtout en
#     CI où DATABASE_URL_STAGING est injecté.
#   - WARN only en v1, pour qu'on calibre le bruit avant de durcir.
#   - Compare uniquement les MODELS (tables Prisma). Les enums et types
#     custom sortent du périmètre v1 (à étendre si on rencontre des cas).
#
# Sabotage-testé 2026-05-23 :
#   - Cas pas de modif Prisma          → exit 0, message clair ✓
#   - Cas avec modif Prisma + pas de DB → WARN+SKIP, exit 0 ✓
#   - Cas drift réel : validé offline en simulant un pulled.prisma avec
#     2 models supplémentaires (FakeDriftTable, AnotherDrift) — `comm -23`
#     ressort bien ces 2 lignes face au schema.prisma actuel. Le pull
#     contre la DB staging postgres-staging (sur dev-pub) marche aussi :
#     33 models extraits, identique au schema (0 drift staging↔schema).
#   - Validation "drift en vrai" (avec DB de référence en TCP joignable
#     depuis le hook) : à confirmer à la 1re exécution CI avec
#     DATABASE_URL_STAGING injecté.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${SKIP_PRISMA_DRIFT:-0}" = "1" ]; then
  echo "⚠ check-prisma-drift.sh skipped via SKIP_PRISMA_DRIFT=1"
  exit 0
fi

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${BASE_REF:-origin/$(git rev-parse --abbrev-ref HEAD)}"
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="origin/main"
fi

echo "${BLUE}── check-prisma-drift : DB réelle vs schema.prisma ──${NC}"

# ─── Gating : ne tourner que si schema Prisma ou migration touché ────────
if [ "$BASE_REF" = "HEAD" ]; then
  CHANGED=$( (git diff --name-only HEAD; git diff --cached --name-only) | sort -u || true )
else
  CHANGED=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || true)
fi

PRISMA_TOUCHED=$(echo "$CHANGED" | grep -E '^prisma/(schema\.prisma|migrations/)' || true)
if [ -z "$PRISMA_TOUCHED" ]; then
  echo "${GREEN}✓ Pas de modif Prisma, check non requis${NC}"
  exit 0
fi

# ─── Trouver une DB de référence ─────────────────────────────────────────
DB_URL=""
DB_SOURCE=""
if [ -n "${PRISMA_DRIFT_DATABASE_URL:-}" ]; then
  DB_URL="$PRISMA_DRIFT_DATABASE_URL"
  DB_SOURCE="PRISMA_DRIFT_DATABASE_URL"
elif [ -n "${DATABASE_URL_STAGING:-}" ]; then
  DB_URL="$DATABASE_URL_STAGING"
  DB_SOURCE="DATABASE_URL_STAGING"
fi

if [ -z "$DB_URL" ]; then
  echo "${YELLOW}⚠ Aucune DB de référence (PRISMA_DRIFT_DATABASE_URL ou DATABASE_URL_STAGING)${NC}"
  echo "${YELLOW}  → check skippé. En CI, injecter DATABASE_URL_STAGING dans le job.${NC}"
  echo "${YELLOW}  En local : SSH tunnel vers postgres-staging puis re-run avec${NC}"
  echo "${YELLOW}    PRISMA_DRIFT_DATABASE_URL=postgresql://... scripts/ci/check-prisma-drift.sh${NC}"
  exit 0
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "${RED}✗ npx introuvable — impossible de lancer prisma${NC}"
  exit 1
fi

# ─── Pull du schéma DB réel ──────────────────────────────────────────────
PULLED="/tmp/pulled-$$.prisma"
PULL_LOG="/tmp/pulled-$$.log"
trap 'rm -f "$PULLED" "$PULL_LOG"' EXIT

echo "  → prisma db pull contre $DB_SOURCE…"

set +e
DATABASE_URL="$DB_URL" npx prisma db pull --print --schema /tmp/dummy-schema.prisma >"$PULLED" 2>"$PULL_LOG"
PULL_EXIT=$?
set -e

if [ "$PULL_EXIT" -ne 0 ] || [ ! -s "$PULLED" ]; then
  echo "${YELLOW}⚠ prisma db pull a échoué (exit $PULL_EXIT) — fin du log :${NC}"
  tail -10 "$PULL_LOG"
  echo "${YELLOW}  → check skippé (incident technique, pas un drift).${NC}"
  exit 0
fi

# ─── Extraction normalisée des MODELS ────────────────────────────────────
# Format Prisma : `model FooBar {` … `}` — on extrait juste les noms.
extract_models() {
  local file="$1"
  grep -E '^model\s+[A-Za-z_][A-Za-z0-9_]*\s*\{' "$file" 2>/dev/null \
    | sed -E 's/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{.*/\1/' \
    | sort -u
}

LOCAL_MODELS=$(extract_models prisma/schema.prisma)
DB_MODELS=$(extract_models "$PULLED")

if [ -z "$DB_MODELS" ]; then
  echo "${YELLOW}⚠ Aucun model trouvé dans le pull — schéma DB vide ou parse raté ?${NC}"
  exit 0
fi

# Models présents en DB mais pas en local = DRIFT (l'app pourrait y toucher
# sans le savoir).
DRIFT=$(comm -23 <(echo "$DB_MODELS") <(echo "$LOCAL_MODELS"))

if [ -z "$DRIFT" ]; then
  echo "${GREEN}✓ schema.prisma couvre tous les models de la DB de référence${NC}"
  exit 0
fi

DRIFT_COUNT=$(echo "$DRIFT" | grep -c . || true)
echo
echo "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
echo "${YELLOW}║ DRIFT Prisma détecté ($DRIFT_COUNT model(s) en DB hors schema)${NC}"
echo "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
echo
echo "${YELLOW}Models présents dans la DB ($DB_SOURCE) mais absents de schema.prisma :${NC}"
echo "$DRIFT" | sed 's/^/  - /'
echo
echo "${YELLOW}Action recommandée :${NC}"
echo "  - Soit ajouter ces models dans schema.prisma (s'ils sont utilisés)"
echo "  - Soit dropper ces tables prod (si vraiment legacy abandonné)"
echo
echo "${YELLOW}WARN only en v1 — push autorisé. Sera durci en BLOCKING quand${NC}"
echo "${YELLOW}les drifts connus (results, segment_catalog, staging_*) seront résorbés.${NC}"

exit 0
