#!/usr/bin/env bash
# Самоограждение основного (Aeza), запуск таймером koop-fence раз в 30 секунд и после загрузки.
# Основной гасит игру сам, если:
#   - не видит ни одного из соседей (Beget, Timeweb) 2 минуты подряд: значит, его отрезало,
#     и через 5 минут соседи переключат игру к себе; к этому моменту здесь писать уже нельзя;
#   - резерв (Beget) уже работает как основная база: переключение случилось без нас
#     (например, мы были недоступны игрокам, но не соседям), или сервер загрузился после аварии.
# Включает игру обратно, только когда соседи видны и база на Beget по-прежнему реплика.
set -uo pipefail
P=/opt/mmo90s
S="$P/infra/standby"
ST=/var/lib/koop-fence
STANDBY=85.198.67.48
PEERS="85.198.67.48 195.133.81.121"
C="docker compose -p mmo90s -f docker-compose.prod.yml -f docker-compose.vps.yml"
mkdir -p "$ST"
notify() { bash "$S/notify.sh" "$1"; }
exec 9>"$ST/lock"
flock -n 9 || exit 0
cd "$P"

reach() { timeout 6 bash -c "exec 3<>/dev/tcp/$1/443" 2>/dev/null; }
seen=0
for p in $PEERS; do reach "$p" && seen=$((seen + 1)); done

standby_role() {
  timeout 20 ssh -i /root/.ssh/koop_witness -o BatchMode=yes -o ConnectTimeout=8 "root@$STANDBY" role 2>/dev/null | sed -n 's/^role=//p'
}

fence() {
  $C stop backend worker frontend >/dev/null 2>&1
  touch "$ST/fenced"
  notify "Игра на Аезе остановлена: $1"
}

if [ "$seen" -eq 0 ]; then
  n=$(( $(cat "$ST/alone" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$ST/alone"
  if [ "$n" -ge 4 ] && [ ! -f "$ST/fenced" ]; then
    fence "Аеза 2 минуты не видит ни Бегет, ни Таймвеб. Чтобы не было двух живых баз, игра здесь выключена."
  fi
  exit 0
fi
echo 0 > "$ST/alone"

role="$(standby_role)"
if [ "$role" = primary ]; then
  if [ ! -f "$ST/fenced" ] || docker ps --format '{{.Names}}' | grep -q '^mmo90s-backend-1$'; then
    fence "резерв на Бегете уже работает как основной. Аезу включать только как копию (infra/standby/README.md)."
  fi
  exit 0
fi

if [ -f "$ST/fenced" ] && [ "$role" = replica ]; then
  $C up -d --no-build >/dev/null 2>&1
  rm -f "$ST/fenced"
  notify "Связь с соседями вернулась, переключения не было. Игра на Аезе снова запущена."
fi
