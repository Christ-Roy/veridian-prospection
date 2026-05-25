#!/usr/bin/env bash
#
# cleanup-dev-pub.sh — cleanup automatique disque dev-pub
#
# Conçu pour tourner via systemd timer toutes les 24h (cf install-cleanup-cron.sh).
# Idempotent, safe à relancer à la main : ne casse aucun container en cours.
#
# Périmètre :
#   1. Images Docker non-référencées (libère ~2-5 GB)
#   2. Containers stoppés > 24h (Playwright/test runners orphelins)
#   3. /tmp/prosp-megabattery, /tmp/hub-megabattery > 7 jours (rsync mega battery)
#   4. /tmp/playwright_*_profile-* > 24h (profils Playwright headless oubliés)
#   5. /tmp/prosp-crawler-* > 1h (filet, le cron Agent J fait déjà à 04:00)
#   6. Volumes Docker dangling (orphelins post compose down -v)
#
# NE TOUCHE PAS :
#   - Volumes nommés actifs (postgres-staging_pgdata, notifuse-staging-db-data, etc.)
#   - Containers running ou recently restarted
#   - /home/ubuntu/* (worktrees agents, .npm, .pnpm-store — gérés à la main)
#   - /var/lib/docker/containers/*-json.log (rotation déjà configurée daemon.json)
#
# Logs : journalctl -u cleanup-dev-pub.service depuis le service systemd
#
set -euo pipefail

LOG_PREFIX="[cleanup-dev-pub]"
TOTAL_FREED_KB=0

log() {
  echo "${LOG_PREFIX} $*"
}

# Compare df avant/après en kB pour reporter l'espace réel libéré
disk_used_kb() {
  df -k / | awk 'NR==2 {print $3}'
}

USED_BEFORE=$(disk_used_kb)

log "=== START $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
log "Disk before: $(df -h / | awk 'NR==2 {print $3 " used / " $4 " avail (" $5 ")"}')"

# 1. Docker images non-référencées
log "Step 1/6 : docker image prune -af"
if docker image prune -af 2>&1 | grep -E "Total reclaimed|reclaimed space" || true; then
  :
fi

# 2. Containers stoppés > 24h (Playwright mega-runner, etc.)
log "Step 2/6 : containers stoppés > 24h"
STOPPED=$(docker ps -a --filter "status=exited" --filter "status=dead" --format '{{.ID}} {{.Names}} {{.Status}}' || true)
if [[ -n "${STOPPED}" ]]; then
  echo "${STOPPED}" | while read -r line; do
    log "  candidat : ${line}"
  done
  docker container prune -f --filter "until=24h" 2>&1 | tail -3 || true
else
  log "  aucun container stoppé"
fi

# 3. /tmp/*-megabattery > 7 jours
log "Step 3/6 : /tmp/*-megabattery > 7 jours"
for dir in /tmp/prosp-megabattery /tmp/hub-megabattery /tmp/notifuse-megabattery /tmp/cms-megabattery; do
  if [[ -d "${dir}" ]]; then
    AGE_DAYS=$(( ( $(date +%s) - $(stat -c %Y "${dir}") ) / 86400 ))
    SIZE=$(du -sh "${dir}" 2>/dev/null | awk '{print $1}')
    if (( AGE_DAYS > 7 )); then
      log "  purge ${dir} (age=${AGE_DAYS}j, size=${SIZE})"
      rm -rf "${dir}" || log "  WARN : rm -rf ${dir} failed (root-owned ?)"
    else
      log "  garde ${dir} (age=${AGE_DAYS}j, size=${SIZE}) — récent, utilisé par agents"
    fi
  fi
done

# 4. /tmp/playwright_*_profile-* > 24h (profils Playwright headless oubliés)
log "Step 4/6 : /tmp/playwright_*_profile-* > 24h"
COUNT=$(find /tmp -maxdepth 1 -name "playwright_*_profile-*" -type d -mmin +1440 2>/dev/null | wc -l)
if (( COUNT > 0 )); then
  log "  ${COUNT} profil(s) Playwright > 24h à supprimer"
  find /tmp -maxdepth 1 -name "playwright_*_profile-*" -type d -mmin +1440 -exec rm -rf {} + 2>&1 \
    | head -5 || log "  WARN : suppression partielle (possibles root-owned files)"
else
  log "  aucun profil Playwright > 24h"
fi

# 5. /tmp/prosp-crawler-* > 1h (cron Agent J fait déjà à 04:00, filet)
log "Step 5/6 : /tmp/prosp-crawler-* > 1h (filet — cron principal à 04:00 UTC)"
COUNT=$(find /tmp -maxdepth 1 -name "prosp-crawler-*" -type d -mmin +60 2>/dev/null | wc -l)
if (( COUNT > 0 )); then
  log "  ${COUNT} résidu(s) crawler > 1h — purge via container alpine (root-owned)"
  docker run --rm -v /tmp:/tmp alpine sh -c \
    'find /tmp -maxdepth 1 -name "prosp-crawler-*" -type d -mmin +60 -exec rm -rf {} +' \
    2>&1 | head -5 || log "  WARN : cleanup container alpine échoué"
else
  log "  aucun résidu crawler"
fi

# 6. Volumes Docker dangling (orphelins compose down -v)
log "Step 6/6 : volumes Docker dangling"
DANGLING=$(docker volume ls -qf dangling=true | wc -l)
if (( DANGLING > 0 )); then
  log "  ${DANGLING} volume(s) dangling — purge"
  docker volume prune -f 2>&1 | tail -3 || true
else
  log "  aucun volume dangling"
fi

USED_AFTER=$(disk_used_kb)
FREED_KB=$(( USED_BEFORE - USED_AFTER ))
FREED_MB=$(( FREED_KB / 1024 ))

log "Disk after: $(df -h / | awk 'NR==2 {print $3 " used / " $4 " avail (" $5 ")"}')"
log "Total freed : ${FREED_MB} MB"
log "=== END $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Alerte si > 90% après cleanup → indique un problème structurel à investiguer
USE_PCT=$(df / | awk 'NR==2 {gsub("%","",$5); print $5}')
if (( USE_PCT > 90 )); then
  log "ALERT : disque toujours à ${USE_PCT}% après cleanup — investiguer manuellement"
  exit 2
fi

exit 0
