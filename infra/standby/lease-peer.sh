#!/usr/bin/env bash
# Beget подтверждает текущую роль Aeza во время недоступности Timeweb.
set -euo pipefail
state=/var/lib/koop-watch
frozen="$state/peer-frozen"

case "${1:-}" in
  --renew)
    [ "${SSH_ORIGINAL_COMMAND:-}" = renew ] || exit 2
    exec 9>"$state/lock"
    flock -w 1 9
    if [ -e "$frozen" ] || [ -e "$state/promotion-approved" ] || [ -e /opt/mmo90s/.failover-done ]; then
      echo revoked
      exit 0
    fi
    # Явная пауза сторожа используется при ручных работах с ролями.
    [ ! -e "$state/disabled" ] || exit 1
    source "$(dirname "$(realpath "$0")")/health.sh"
    [ "$(postgres 'SELECT pg_is_in_recovery()')" = t ]
    docker exec mmo90s-redis-1 redis-cli --raw info replication | grep -Fxq $'role:slave\r'
    echo granted
    ;;
  --freeze)
    # Вызывается из watch.sh, который уже держит state/lock.
    boot="$(cat /proc/sys/kernel/random/boot_id)"
    read -r uptime _ < /proc/uptime
    if [ ! -e "$frozen" ]; then
      umask 077
      printf '%s %s\n' "$boot" "${uptime%.*}" > "$frozen.tmp"
      mv -f "$frozen.tmp" "$frozen"
      sync -f "$state"
    fi
    read -r frozen_boot frozen_at < "$frozen"
    [[ "$frozen_at" =~ ^[0-9]+$ ]]
    if [ "$frozen_boot" != "$boot" ]; then frozen_at=0; fi
    if [ "$((${uptime%.*} - frozen_at))" -ge 150 ]; then
      echo fenced
    else
      echo waiting
    fi
    ;;
  *) exit 2 ;;
esac
