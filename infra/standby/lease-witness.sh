#!/usr/bin/env bash
# Аренда на Timeweb. Два отдельных SSH-ключа с принудительной командой:
# Aeza может только продлевать аренду, Beget — только отзывать её и проверять статус.
set -euo pipefail
state=/var/lib/koop-lease
mkdir -p "$state"
exec 9>"$state/lock"
flock -x 9

case "${1:-}:${SSH_ORIGINAL_COMMAND:-}" in
  aeza:renew)
    if [ -e "$state/revoked" ]; then
      echo revoked
    else
      echo granted
    fi
    ;;
  beget:freeze)
    boot="$(cat /proc/sys/kernel/random/boot_id)"
    read -r uptime _ < /proc/uptime
    if [ ! -e "$state/revoked" ]; then
      if curl --noproxy '*' -fsS --max-time 6 --resolve 'kooperativ.space:443:82.148.244.248' \
          https://kooperativ.space/ready | grep -Fq '"status":"ready"'; then
        echo healthy
        exit 0
      fi
      read -r uptime _ < /proc/uptime
      printf '%s %s\n' "$boot" "${uptime%.*}" > "$state/revoked.tmp"
      mv -f "$state/revoked.tmp" "$state/revoked"
      sync -f "$state"
    fi
    read -r revoked_boot revoked_at < "$state/revoked"
    [[ "$revoked_at" =~ ^[0-9]+$ ]]
    if [ "$revoked_boot" != "$boot" ]; then revoked_at=0; fi
    # Аренда ядра Aeza живёт до 90 с. Запас покрывает доставку SSH и перезапуск свидетеля.
    if [ "$((${uptime%.*} - revoked_at))" -ge 150 ]; then
      echo fenced
    else
      echo waiting
    fi
    ;;
  beget:status)
    if [ -e "$state/revoked" ]; then echo revoked; else echo open; fi
    ;;
  *) exit 2 ;;
esac
