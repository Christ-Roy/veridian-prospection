#!/usr/bin/env bash
#
# sync-to-dev-server.sh — live sync local dashboard → dev-server Tailscale.
#
# Objet: permettre un workflow `édit sur mail → HMR instantané sur
# http://100.92.215.42:3000` pour développer la feature workspace sans
# avoir à commit + push + build Docker à chaque changement.
#
# Prérequis côté dev-server (100.92.215.42):
#   - /home/ubuntu/prospection-dashboard-dev/ clone du repo + npm ci
#   - npm run dev tourne sur le port 3000 (géré par /tmp/next-watchdog.sh)
#   - prospection-dev-db Postgres container écoute sur 127.0.0.1:15433
#
# Prérequis côté local (mail):
#   - inotifywait (paquet inotify-tools) ou fswatch
#   - clé SSH pour ubuntu@37.187.199.185 (alias dev-pub)
#
# Usage:
#   cd prospection/dashboard
#   bash scripts/sync-to-dev-server.sh            # démarre la boucle
#   bash scripts/sync-to-dev-server.sh --once     # fait un sync unique
#
# Le sync initial est fait au lancement. Ensuite toute modification
# dans src/, prisma/, public/, scripts/, e2e/, next.config.ts, package.json
# etc. déclenche un rsync incrémental. Next HMR pick up les changements
# via le watcher interne de Next (FS polling sur .next/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # dashboard/
REMOTE_HOST="${REMOTE_HOST:-dev-pub}"        # ssh alias (voir ~/.ssh/config)
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/prospection-dashboard-dev}"

RSYNC_OPTS=(
  -az
  --delete
  --exclude 'node_modules/'
  --exclude '.next/'
  --exclude 'test-results/'
  --exclude 'playwright-report/'
  --exclude '.env.local'
  --exclude 'src/generated/'
  --exclude 'tsconfig.tsbuildinfo'
  --exclude '.git/'
  --exclude '*.log'
)

log() {
  echo -e "\033[1;34m[sync]\033[0m $(date +%H:%M:%S) $*"
}

do_sync() {
  local start=$(date +%s%N)
  rsync "${RSYNC_OPTS[@]}" "$LOCAL_DIR/" "$REMOTE_HOST:$REMOTE_DIR/" 2>&1 | grep -v '^$' || true
  local end=$(date +%s%N)
  local ms=$(( (end - start) / 1000000 ))
  log "sync done (${ms}ms)"
}

# Initial full sync
log "initial sync $LOCAL_DIR → $REMOTE_HOST:$REMOTE_DIR"
do_sync

if [[ "${1:-}" == "--once" ]]; then
  log "single sync mode — exiting"
  exit 0
fi

# Watch loop
if ! command -v inotifywait >/dev/null 2>&1; then
  echo "ERROR: inotifywait not found (apt install inotify-tools)" >&2
  exit 1
fi

log "watching $LOCAL_DIR for changes (Ctrl-C to stop)..."

# Debounce: si plusieurs events arrivent dans un court laps, on ne sync qu'une fois
DEBOUNCE_MS=400
last_sync_ns=0

# inotifywait n'accepte qu'un seul --exclude, on combine tout en une regex
INOTIFY_EXCLUDE='(^|/)(node_modules|\.next|test-results|playwright-report|\.git|src/generated)(/|$)|\.(log|tsbuildinfo)$|\.env\.local$'

inotifywait -mrq \
  -e modify -e create -e delete -e move \
  --exclude "$INOTIFY_EXCLUDE" \
  --format '%w%f %e' \
  "$LOCAL_DIR" | while read -r line; do
  now_ns=$(date +%s%N)
  elapsed_ms=$(( (now_ns - last_sync_ns) / 1000000 ))
  if (( elapsed_ms < DEBOUNCE_MS )); then
    continue
  fi
  # Petite pause pour laisser plusieurs saves s'agréger
  sleep 0.$(printf '%03d' $DEBOUNCE_MS)
  log "change detected: $line"
  do_sync
  last_sync_ns=$(date +%s%N)
done
