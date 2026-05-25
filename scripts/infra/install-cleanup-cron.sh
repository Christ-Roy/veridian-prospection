#!/usr/bin/env bash
#
# install-cleanup-cron.sh — installe le timer systemd pour cleanup-dev-pub.sh
#
# Action infra à exécuter UNE FOIS sur dev-pub par Robert ou un agent infra.
# Le script à lui-même est idempotent : peut être re-run pour mettre à jour
# les units systemd si on les modifie.
#
# Usage (depuis dev-pub) :
#   bash ~/scripts/infra/install-cleanup-cron.sh
#
# OU à distance depuis ta machine locale :
#   scp scripts/infra/{cleanup-dev-pub.sh,install-cleanup-cron.sh} dev-pub:~/scripts/infra/
#   ssh dev-pub 'bash ~/scripts/infra/install-cleanup-cron.sh'
#
set -euo pipefail

# Le script de cleanup doit être déjà présent à cet emplacement sur dev-pub
SCRIPT_PATH="${HOME}/scripts/infra/cleanup-dev-pub.sh"
SERVICE_NAME="cleanup-dev-pub"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

if [[ ! -f "${SCRIPT_PATH}" ]]; then
  echo "ERREUR : ${SCRIPT_PATH} introuvable."
  echo "Déploie d'abord :"
  echo "  scp scripts/infra/cleanup-dev-pub.sh dev-pub:~/scripts/infra/"
  exit 1
fi

chmod +x "${SCRIPT_PATH}"
mkdir -p "${SYSTEMD_USER_DIR}"

# === Service unit ===
cat > "${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Cleanup disk space on dev-pub (Docker images, /tmp megabattery, Playwright profiles)
Documentation=https://github.com/Christ-Roy/veridian-prospection/blob/staging/docs/INFRA-DEV-PUB-DISK.md

[Service]
Type=oneshot
ExecStart=/bin/bash ${SCRIPT_PATH}
StandardOutput=journal
StandardError=journal
# Le script docker requiert que le user puisse docker (groupe docker)
# Pas de Nice/IOSchedulingClass : le cleanup tourne à 03:00 UTC, pas de risque conflit
EOF

# === Timer unit ===
cat > "${SYSTEMD_USER_DIR}/${SERVICE_NAME}.timer" <<EOF
[Unit]
Description=Run cleanup-dev-pub every day at 03:00 UTC
Documentation=https://github.com/Christ-Roy/veridian-prospection/blob/staging/docs/INFRA-DEV-PUB-DISK.md

[Timer]
# 03:00 UTC = creux d'activité agents (avant cron crawler Agent J à 04:00)
OnCalendar=*-*-* 03:00:00 UTC
# Si dev-pub était down à 03:00, rattrape au reboot
Persistent=true
# Délai aléatoire 0-300s pour éviter pic CPU si plusieurs jobs au même horaire
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

# === Activation ===
systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.timer"
systemctl --user start "${SERVICE_NAME}.timer"

# === Verification ===
echo ""
echo "=== Status timer ==="
systemctl --user status "${SERVICE_NAME}.timer" --no-pager || true
echo ""
echo "=== Next run ==="
systemctl --user list-timers "${SERVICE_NAME}.timer" --no-pager
echo ""
echo "=== Lancer manuellement pour tester ==="
echo "  systemctl --user start ${SERVICE_NAME}.service"
echo "  journalctl --user -u ${SERVICE_NAME}.service -n 100 --no-pager"
echo ""
echo "=== Linger requis pour user systemd (sinon timer ne tourne pas si user non-loggé) ==="
echo "  sudo loginctl enable-linger \$USER   # à faire UNE fois en sudo"
echo ""
echo "OK — timer installé. Prochain run automatique à 03:00 UTC."
