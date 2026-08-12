#!/usr/bin/env bash
#
# Preflight opérateur pour le cutover Prospection monolithe -> split.
#
# À lancer APRÈS `nomad-v stop prospection` et AVANT `nomad-v deploy`.
# Il refuse si l'ancienne alloc `stack` tourne encore, si le futur port DB
# Tailscale :15432 est déjà occupé, ou si le volume PostgreSQL local est encore
# utilisé par un conteneur/process.
set -euo pipefail

NOMAD_V="${NOMAD_V:-/home/brunon5/bin/nomad-v}"
PROD_SSH="${PROD_SSH:-prod-pub}"
JOB_ID="${JOB_ID:-prospection}"
OLD_GROUP="${OLD_GROUP:-stack}"
DB_PORT="${DB_PORT:-15432}"
DB_VOLUME="${DB_VOLUME:-/opt/veridian-lab/prospection/db}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/brunon5/backups/veridian/bulk}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"

die() {
  printf "::error::%b\n" "$*" >&2
  exit 1
}

info() {
  echo "→ $*"
}

info "Vérification backup Prospection récent"
latest_backup="$(find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -type f -name 'prospection.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 || true)"
[ -n "$latest_backup" ] || die "aucun backup prospection.dump trouvé dans $BACKUP_ROOT"
backup_epoch="${latest_backup%% *}"
backup_path="${latest_backup#* }"
[ -s "$backup_path" ] || die "backup vide: $backup_path"
now_epoch="$(date +%s)"
backup_age_seconds="$(python3 - "$backup_epoch" "$now_epoch" <<'PY'
import sys
print(int(float(sys.argv[2]) - float(sys.argv[1])))
PY
)"
max_age_seconds="$((MAX_BACKUP_AGE_HOURS * 3600))"
[ "$backup_age_seconds" -le "$max_age_seconds" ] || die "backup trop ancien: $backup_path (${backup_age_seconds}s > ${max_age_seconds}s)"
echo "✓ backup récent: $backup_path"

info "Vérification qu'aucune allocation Nomad '$OLD_GROUP' ne tourne encore"
allocs_json_file="$(mktemp)"
trap 'rm -f "$allocs_json_file"' EXIT
"$NOMAD_V" raw job allocs -json "$JOB_ID" >"$allocs_json_file"
running_old_allocs="$(OLD_GROUP="$OLD_GROUP" python3 - "$allocs_json_file" <<'PY'
import json
import os
import sys

old_group = os.environ["OLD_GROUP"]
with open(sys.argv[1], encoding="utf-8") as handle:
    allocs = json.load(handle)
bad = []
for alloc in allocs:
    if (
        alloc.get("TaskGroup") == old_group
        and alloc.get("ClientStatus") in {"running", "pending", "starting"}
        and alloc.get("DesiredStatus") == "run"
    ):
        bad.append(
            f"{alloc.get('ID', '')[:8]} group={alloc.get('TaskGroup')} "
            f"client={alloc.get('ClientStatus')} desired={alloc.get('DesiredStatus')}"
        )
print("\n".join(bad))
PY
)"
[ -z "$running_old_allocs" ] || die "ancienne allocation '$OLD_GROUP' encore active:\n$running_old_allocs"
echo "✓ aucune allocation '$OLD_GROUP' active"

info "Vérification que le port Tailscale Postgres :$DB_PORT est libre sur $PROD_SSH"
port_users="$(ssh "$PROD_SSH" "ss -ltnpH 2>/dev/null | grep -E '(^|[[:space:]])[^[:space:]]*:$DB_PORT[[:space:]]' || true")"
[ -z "$port_users" ] || die "port :$DB_PORT déjà occupé sur $PROD_SSH:\n$port_users"
echo "✓ port :$DB_PORT libre"

info "Vérification qu'aucun conteneur Docker ne monte $DB_VOLUME"
docker_users="$(ssh "$PROD_SSH" "docker ps --filter volume=$DB_VOLUME --format '{{.ID}} {{.Names}}' 2>/dev/null || true")"
[ -z "$docker_users" ] || die "volume encore monté par conteneur Docker:\n$docker_users"
echo "✓ aucun conteneur Docker ne monte le volume"

info "Vérification qu'aucun process ne tient encore le volume ouvert"
process_users="$(ssh "$PROD_SSH" "timeout 20s sudo lsof -nP +D '$DB_VOLUME' 2>/dev/null | sed -n '1,25p' || true")"
[ -z "$process_users" ] || die "volume encore ouvert par un process:\n$process_users"
echo "✓ volume non ouvert"

echo "✓ Preflight cutover Prospection OK"
