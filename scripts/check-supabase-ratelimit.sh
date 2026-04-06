#!/bin/bash
# check-supabase-ratelimit.sh — CI guard against Supabase admin API abuse
#
# Scans API route handlers for uncached Supabase admin calls that could
# cause rate limiting. Fails if found in hot-path files.
#
# Hot paths = files called on every page load or user action:
#   /api/prospects, /api/pipeline, /api/health, /api/settings, /api/trial,
#   /api/me, /api/stats/*, lib/trial.ts, lib/supabase/api-auth.ts

set -euo pipefail

HOT_PATHS=(
  "src/app/api/prospects/route.ts"
  "src/app/api/pipeline/route.ts"
  "src/app/api/health/route.ts"
  "src/app/api/settings/route.ts"
  "src/app/api/me/route.ts"
  "src/app/api/sans-site-filters/route.ts"
  "src/lib/trial.ts"
)

DANGEROUS_PATTERNS=(
  "admin.auth.admin"
  "getUserById"
  "listUsers"
  "admin.createUser"
)

FOUND=0

for file in "${HOT_PATHS[@]}"; do
  if [ ! -f "$file" ]; then continue; fi
  # Strip comments before checking
  CODE=$(sed 's|//.*||g' "$file" | sed '/\/\*/,/\*\//d')
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if echo "$CODE" | grep -q "$pattern"; then
      echo "❌ RATELIMIT RISK: $file contains '$pattern' in code (not comment)"
      FOUND=$((FOUND + 1))
    fi
  done
done

if [ "$FOUND" -gt 0 ]; then
  echo ""
  echo "🚨 $FOUND Supabase admin API call(s) found in hot paths!"
  echo "   These cause rate limiting for ALL users (shared SERVICE_ROLE_KEY)."
  echo "   Fix: use cached helpers or move to cold paths (/api/admin/*)."
  exit 1
fi

echo "✅ No uncached Supabase admin API calls in hot paths"
