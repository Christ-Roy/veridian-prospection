#!/usr/bin/env bash
# Watcher hot reload UI — veridian-prospection
#
# Surveille src/ + public/ + les fichiers de config UI en local et rsync
# chaque changement vers dev-pub:~/prospection-ui-dev où tourne `next dev`.
# Le hot reload Next recompile automatiquement → l'UI se met à jour live
# sur https://ui-dev.staging.veridian.site
#
# Usage : bash scripts/ui-dev-watch.sh   (laisser tourner en arrière-plan)
# Stop  : Ctrl-C
#
# NE PAS confondre avec un déploiement : ça synchronise un environnement
# de revue UI éphémère, pas la prod ni le staging déployé.

set -uo pipefail

LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="dev-pub:~/prospection-ui-dev/"
# Tailwind v4 : pas de tailwind.config.ts — la config vit dans src/app/globals.css
WATCH_PATHS=(src public postcss.config.mjs next.config.ts components.json)

# Filtre rsync : on ne pousse jamais node_modules / .next / .git
RSYNC_OPTS=(-az --delete
  --exclude node_modules --exclude .next --exclude .git
  --exclude '*.log' --exclude .env)

sync_now() {
  rsync "${RSYNC_OPTS[@]}" \
    "${WATCH_PATHS[@]/#/$LOCAL_DIR/}" \
    "$REMOTE" 2>&1 | grep -vE '^$' || true
}

echo "[ui-dev-watch] sync initial → $REMOTE"
# rsync chaque chemin watché individuellement pour garder l'arborescence
for p in "${WATCH_PATHS[@]}"; do
  [ -e "$LOCAL_DIR/$p" ] || continue
  rsync "${RSYNC_OPTS[@]}" "$LOCAL_DIR/$p" "$REMOTE" >/dev/null 2>&1
done
echo "[ui-dev-watch] prêt — hot reload : https://ui-dev.staging.veridian.site"
echo "[ui-dev-watch] watching : ${WATCH_PATHS[*]}"

# Boucle inotify : à chaque write/create/delete/move, re-sync
inotifywait -m -r -e modify,create,delete,move --format '%w%f' \
  "${WATCH_PATHS[@]/#/$LOCAL_DIR/}" 2>/dev/null | while read -r changed; do
  # Ignore les fichiers temporaires d'éditeur
  case "$changed" in
    *~|*.swp|*.tmp|*/.*) continue ;;
  esac
  for p in "${WATCH_PATHS[@]}"; do
    [ -e "$LOCAL_DIR/$p" ] || continue
    rsync "${RSYNC_OPTS[@]}" "$LOCAL_DIR/$p" "$REMOTE" >/dev/null 2>&1
  done
  echo "[ui-dev-watch] $(date +%H:%M:%S) synced ← ${changed#$LOCAL_DIR/}"
done
