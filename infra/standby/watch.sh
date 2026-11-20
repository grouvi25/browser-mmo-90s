#!/usr/bin/env bash
# Beget проверяет Aeza, ждёт свидетельство Timeweb и закрытие аренды Aeza.
# Повышение базы и смена DNS повторяются независимо при сбоях.
set -euo pipefail
P=/opt/mmo90s
S="$(dirname "$(realpath "$0")")"
ST=/var/lib/koop-watch
WITNESS=195.133.81.121
source "$S/health.sh"
mkdir -p "$ST"
exec 9>"$ST/lock"
flock -n 9 || exit 0
[ ! -e "$ST/disabled" ] || exit 0

notify() { bash "$S/notify.sh" "$1"; }
warn() {
  local key="$1"
  echo "$2" >&2
  if [ ! -e "$ST/$key" ] || [ -n "$(find "$ST/$key" -mmin +60)" ]; then
    touch "$ST/$key"
    notify "$2"
  fi
}
lease() {
  timeout -k 2 12 ssh -n -i /root/.ssh/koop_lease -o BatchMode=yes \
    -o ConnectTimeout=6 -o StrictHostKeyChecking=yes "root@$WITNESS" "$1"
}

if [ -e "$P/.failover-done" ] && [ -e "$ST/dns-done" ]; then exit 0; fi
if [ ! -e "$ST/promotion-approved" ]; then
  now="$(date +%s)"
  if ready_at "$KOOP_AEZA"; then
    rm -f "$ST/down-since" "$ST/split" "$ST/stale"
    if [ "$(postgres "SELECT pg_is_in_recovery() AND NOT pg_is_wal_replay_paused() AND EXISTS (SELECT 1 FROM pg_stat_wal_receiver WHERE status = 'streaming' AND last_msg_receipt_time > now() - interval '2 minutes') AND pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) <= 16777216")" = t ] &&
       docker exec mmo90s-redis-1 redis-cli --raw info replication | grep -Fxq $'master_link_status:up\r'; then
      echo "$now" > "$ST/replica-ok"
      rm -f "$ST/repl"
    else
      warn repl "Реплика PostgreSQL или Redis на Beget отстаёт. Автопереключение требует свежей копии."
    fi
    exit 0
  fi
  down="$(cat "$ST/down-since" 2>/dev/null || echo "$now")"
  [[ "$down" =~ ^[0-9]+$ ]]
  echo "$down" > "$ST/down-since"
  [ "$((now - down))" -ge 300 ] || exit 0
  last="$(cat "$ST/replica-ok" 2>/dev/null || echo 0)"
  [[ "$last" =~ ^[0-9]+$ ]]
  if [ "$last" -gt "$down" ] || [ "$((down - last))" -gt 120 ]; then
    warn stale "Aeza недоступна, свежесть реплик Beget перед сбоем не подтверждена. Нужна проверка."
    exit 1
  fi
  vote="$(timeout -k 2 35 ssh -n -i /root/.ssh/koop_witness -o BatchMode=yes \
    -o ConnectTimeout=8 -o StrictHostKeyChecking=yes "root@$WITNESS" status)" || vote=unknown
  case "$vote" in
    aeza=down\ role=*) ;;
    *) warn split "Проверка Timeweb не подтвердила отключение Aeza. Резерв ждёт." ; exit 0 ;;
  esac
  status="$(lease status)"
  if [ "$status" = open ]; then
    bash "$S/failover.sh" --preflight
    python3 "$S/dns-cloudflare.py" --dry-run
    if ready_at "$KOOP_AEZA"; then exit 0; fi
  elif [ "$status" != revoked ]; then
    exit 1
  fi
  witness_fence="$(lease freeze)"
  case "$witness_fence" in
    healthy) exit 0 ;;
    waiting|fenced) ;;
    *) exit 1 ;;
  esac
  # Держим тот же lock, что и запасная выдача аренды. С этого момента
  # закрыты оба источника, а срок последней аренды Beget ещё может идти.
  peer_fence="$(bash "$S/lease-peer.sh" --freeze)"
  [ "$witness_fence" = fenced ] && [ "$peer_fence" = fenced ] || exit 0
  touch "$ST/promotion-approved"
fi

if [ ! -e "$P/.failover-done" ]; then
  if ! bash "$S/failover.sh" > "$ST/failover.log" 2>&1; then
    warn promotion-error "Запуск игры на Beget пока не удался. Повторю. Журнал $ST/failover.log."
    exit 1
  fi
fi
if beget_ready && python3 "$S/dns-cloudflare.py" >> "$ST/failover.log" 2>&1; then
  touch "$ST/dns-done"
  notify "Игра работает на Beget, оба NS Cloudflare возвращают $KOOP_BEGET. Aeza ограждена."
else
  warn dns-error "Beget ещё не прошёл проверку HTTPS или DNS Cloudflare. Сторож повторит проверку."
  exit 1
fi
