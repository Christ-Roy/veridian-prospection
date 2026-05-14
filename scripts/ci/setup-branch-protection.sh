#!/usr/bin/env bash
# setup-branch-protection.sh
#
# Verrouille la branche `main` : aucun push direct accepté.
# Tout passe par PR depuis `staging` avec CI verte.
#
# À lancer UNE SEULE FOIS après que le workflow `Prospection CI/CD` ait
# tourné au moins une fois en vert sur main (sinon GitHub refuse de
# référencer un status check qui n'existe pas).
#
# Usage : bash scripts/ci/setup-branch-protection.sh
set -euo pipefail

REPO="Christ-Roy/veridian-prospection"
BRANCH="main"

# Status checks bloquants — doivent être verts pour merger une PR vers main.
# Noms exacts tels que GitHub les voit (case-sensitive).
REQUIRED_CHECKS=$(jq -n '[
  "Quality gate (test-mapping + tsc + eslint + vitest)",
  "CVE audit (high+critical bloquant) / CVE audit (high+critical bloquant)",
  "build",
  "integration",
  "Trivy scan (CRITICAL+HIGH bloquant)"
]')

echo "═══ Setup branch protection $BRANCH sur $REPO ═══"
echo "Required checks :"
echo "$REQUIRED_CHECKS" | jq -r '.[] | "  - " + .'
echo

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/$REPO/branches/$BRANCH/protection" \
  -f required_status_checks[strict]=true \
  --raw-field required_status_checks[contexts]="$REQUIRED_CHECKS" \
  -f enforce_admins=true \
  -F required_pull_request_reviews= \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  --jq '"✓ Branch protection activée sur " + .url'

echo
echo "État actuel :"
gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{
  required_status_checks: .required_status_checks.contexts,
  enforce_admins: .enforce_admins.enabled,
  allow_force_pushes: .allow_force_pushes.enabled,
  allow_deletions: .allow_deletions.enabled
}'
