#!/usr/bin/env bash
# Свидетель для автопереключения. Стоит на каждом сервере за forced command ключей соседей.
#   status — видит ли этот сервер игру на основном и кем здесь работает база:
#            "aeza=up|down role=replica|primary|unknown"
#   role   — только роль базы (быстро, без проверки основного)
set -uo pipefail
PRIMARY=82.148.244.248

role() {
  local r
  r="$(docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select pg_is_in_recovery()"' 2>/dev/null)"
  case "$r" in t) echo replica ;; f) echo primary ;; *) echo unknown ;; esac
}

case "${SSH_ORIGINAL_COMMAND:-status}" in
  status)
    aeza=down
    for i in 1 2 3; do
      if curl -sk -m 6 --resolve "kooperativ.space:443:$PRIMARY" https://kooperativ.space/ready | grep -q '"ready"'; then aeza=up; break; fi
      sleep 2
    done
    echo "aeza=$aeza role=$(role)"
    ;;
  role)
    echo "role=$(role)"
    ;;
  *)
    echo "Команда запрещена" >&2
    exit 2
    ;;
esac
