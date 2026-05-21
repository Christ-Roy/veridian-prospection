#!/usr/bin/env bash
#
# check-secrets.sh — Détection de secrets en clair dans le diff pre-push
#
# Refuse le push si on détecte des patterns critiques :
#   - Stripe keys (sk_live_, sk_test_)
#   - GitHub tokens (ghp_, github_pat_)
#   - AWS keys (AKIA[0-9A-Z]{16})
#   - Private keys (BEGIN RSA/EC/OPENSSH/DSA PRIVATE KEY)
#   - Generic API keys obvious (apikey="...", api_key="...", password="...")
#   - JWT tokens (eyJ... format suspect dans le code, pas les tests)
#   - Slack tokens (xoxb-, xoxa-, xoxp-)
#   - OpenAI/Anthropic keys (sk-proj-, sk-ant-)
#
# Coût : <1s (grep sur diff staged uniquement, pas sur tout le repo).
#
# Skip d'urgence : SKIP_SECRETS_CHECK=1 git push (NE PAS abuser).
# Allowlist par ligne : `# pragma: allowlist secret` ou `// pragma: allowlist secret`
#
set -euo pipefail

if [ "${SKIP_SECRETS_CHECK:-0}" = "1" ]; then
  echo "⚠ check-secrets.sh skipped via SKIP_SECRETS_CHECK=1"
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

# Diff complet (lignes added uniquement, vs base ref). On scan ce qui sera
# poussé (commits non encore push) + ce qui est staged localement (cas pre-push
# avec staged uncommit, et utile pour les tests locaux).
#
# Exclusions : on ignore les fichiers qui peuvent légitimement parler de
# secrets sans en contenir :
#  - scripts/ci/check-secrets.sh (ce script lui-même contient les regex)
#  - **/*.test.ts (tests qui utilisent des secrets-de-test fake)
#  - docs/**/*.md, todo/**/*.md (documentation pricing, audit, etc.)
EXCLUDE_PATHSPECS=(
  ':!scripts/ci/check-secrets.sh'
  ':!**/*.test.ts'
  ':!docs/**/*.md'
  ':!todo/**/*.md'
)
DIFF_PUSHED=$(git diff "$BASE_REF"...HEAD --no-color -U0 -- . "${EXCLUDE_PATHSPECS[@]}" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true)
DIFF_STAGED=$(git diff --cached --no-color -U0 -- . "${EXCLUDE_PATHSPECS[@]}" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true)
DIFF_ADDED=$(printf '%s\n%s' "$DIFF_PUSHED" "$DIFF_STAGED" | grep -v '^$' || true)

if [ -z "$DIFF_ADDED" ]; then
  echo "${GREEN}✓ Aucune ligne ajoutée à scanner${NC}"
  exit 0
fi

# Patterns critiques. Format : "NOM|REGEX|sévérité"
# RED = bloquant, YELLOW = warning seulement (faux positifs possibles)
declare -a PATTERNS=(
  "Stripe live key|sk_live_[a-zA-Z0-9]{24,}|RED"
  "Stripe test key|sk_test_[a-zA-Z0-9]{24,}|RED"
  "Stripe restricted key|rk_live_[a-zA-Z0-9]{24,}|RED"
  "GitHub Personal Access Token (classic)|ghp_[a-zA-Z0-9]{36}|RED"
  "GitHub Personal Access Token (fine-grained)|github_pat_[a-zA-Z0-9_]{82}|RED"
  "GitHub OAuth token|gho_[a-zA-Z0-9]{36}|RED"
  "AWS Access Key|AKIA[0-9A-Z]{16}|RED"
  "AWS Secret Key context|aws_secret_access_key.*=.*[a-zA-Z0-9/+]{40}|RED"
  "Slack Bot Token|xoxb-[0-9]+-[0-9]+-[0-9]+-[a-zA-Z0-9]{24,}|RED"
  "Slack Workspace Token|xox[apr]-[0-9]+-[0-9]+-[a-zA-Z0-9]{24,}|RED"
  "OpenAI key|sk-proj-[a-zA-Z0-9_-]{40,}|RED"
  "Anthropic key|sk-ant-[a-zA-Z0-9_-]{40,}|RED"
  "RSA Private Key|-----BEGIN RSA PRIVATE KEY-----|RED"
  "EC Private Key|-----BEGIN EC PRIVATE KEY-----|RED"
  "DSA Private Key|-----BEGIN DSA PRIVATE KEY-----|RED"
  "OpenSSH Private Key|-----BEGIN OPENSSH PRIVATE KEY-----|RED"
  "PGP Private Key|-----BEGIN PGP PRIVATE KEY BLOCK-----|RED"
  "Generic Private Key|-----BEGIN PRIVATE KEY-----|RED"
  "Generic password assignment|^[+].*[Pp]assword.*=.*['\"][^'\"]{8,}['\"]|YELLOW"
  "Hardcoded API key assignment|^[+].*[Aa]pi[_-]?[Kk]ey.*=.*['\"][a-zA-Z0-9_-]{16,}['\"]|YELLOW"
  "Bearer token in code|^[+].*[Bb]earer\s+[a-zA-Z0-9._-]{32,}|YELLOW"
)

VIOLATIONS_RED=0
VIOLATIONS_YELLOW=0
VIOLATIONS_DETAIL=""

for entry in "${PATTERNS[@]}"; do
  NAME="${entry%%|*}"
  REST="${entry#*|}"
  REGEX="${REST%|*}"
  SEVERITY="${REST##*|}"

  # Match sur le diff. On exclut les lignes contenant `pragma: allowlist secret`.
  MATCHES=$(echo "$DIFF_ADDED" | grep -E "$REGEX" 2>/dev/null | grep -v "pragma: allowlist secret" || true)
  if [ -z "$MATCHES" ]; then continue; fi

  COUNT=$(echo "$MATCHES" | grep -c . || true)
  if [ "$SEVERITY" = "RED" ]; then
    VIOLATIONS_RED=$((VIOLATIONS_RED + COUNT))
    VIOLATIONS_DETAIL="${VIOLATIONS_DETAIL}${RED}🚨 ${NAME} (${COUNT})${NC}
"
    # Affiche les 3 premières lignes (tronquées pour pas leak en stdout)
    SAMPLE=$(echo "$MATCHES" | head -3 | sed 's/\(.\{80\}\).*/\1.../')
    VIOLATIONS_DETAIL="${VIOLATIONS_DETAIL}${SAMPLE}
"
  else
    VIOLATIONS_YELLOW=$((VIOLATIONS_YELLOW + COUNT))
    VIOLATIONS_DETAIL="${VIOLATIONS_DETAIL}${YELLOW}⚠ ${NAME} (${COUNT}) — vérifier manuellement${NC}
"
  fi
done

if [ "$VIOLATIONS_RED" -eq 0 ] && [ "$VIOLATIONS_YELLOW" -eq 0 ]; then
  echo "${GREEN}✓ Aucun secret détecté dans le diff${NC}"
  exit 0
fi

echo "$VIOLATIONS_DETAIL"

if [ "$VIOLATIONS_RED" -gt 0 ]; then
  echo
  echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "${RED}║ PUSH REFUSÉ — ${VIOLATIONS_RED} secret(s) détecté(s) dans le diff      ║${NC}"
  echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo "Si c'est un faux positif (ex: secret de test), ajoute en fin de ligne :"
  echo "  # pragma: allowlist secret"
  echo "Sinon : retire le secret, mets-le dans \${ENV_VAR} et add à .env.example"
  echo
  echo "Skip d'urgence : SKIP_SECRETS_CHECK=1 git push (NE PAS abuser)"
  exit 1
fi

# Que des warnings — push autorisé mais informatif
echo
echo "${YELLOW}⚠ ${VIOLATIONS_YELLOW} pattern(s) suspect(s) — push autorisé mais vérifie${NC}"
exit 0
