#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/mmo90s}"
cd "$PROJECT_DIR"

# Secrets must only be readable by root.
chmod 600 .env backend/.env
mkdir -p backups
chmod 700 backups

# Keep exactly one canonical nginx vhost for the game.
ln -sfn "$PROJECT_DIR/infra/nginx/vhost-vps.conf" /etc/nginx/sites-enabled/mmo90s-game
if [[ -e /etc/nginx/sites-enabled/mmo90s ]]; then
  rm -f /etc/nginx/sites-enabled/mmo90s
fi
nginx -t
systemctl reload nginx

# Daily verified PostgreSQL backups with a persistent systemd timer.
install -m 0644 "$PROJECT_DIR/infra/systemd/mmo90s-backup.service" /etc/systemd/system/mmo90s-backup.service
install -m 0644 "$PROJECT_DIR/infra/systemd/mmo90s-backup.timer" /etc/systemd/system/mmo90s-backup.timer
systemctl daemon-reload
systemctl enable --now mmo90s-backup.timer

# Restrict the host firewall to SSH and public web traffic.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Password login stays enabled during migration.
# Set DISABLE_PASSWORD_SSH=true only after key access is independently verified.
if [[ "${DISABLE_PASSWORD_SSH:-false}" == "true" ]]; then
  install -d -m 0755 /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/99-mmo90s-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
  sshd -t
  systemctl reload ssh
fi

systemctl --no-pager status mmo90s-backup.timer | head -20
ufw status verbose
