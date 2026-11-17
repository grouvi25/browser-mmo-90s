#!/usr/bin/env bash
# Сторож на резерве (Beget), запуск таймером koop-watch раз в 30 секунд.
# Автопереключение по кворуму: игра переезжает сюда, только если
#   - отсюда основной (Aeza) не отвечает DOWN_LIMIT проверок подряд (по умолчанию 5 минут), и
#   - третий сервер (Timeweb) сам проверил и тоже его не видит.
# Если Timeweb основной видит, порвалась связь, а не упал сервер: не переключаем.
# Если Timeweb недоступен, возможно отрезан сам резерв: тоже не переключаем.
# Основной сам гасит игру, когда не видит обоих соседей (fence.sh), поэтому двух живых баз не будет.
# Выключатель: touch /var/lib/koop-watch/disabled (например, на время учебной тревоги или работ).
set -uo pipefail
P=/opt/mmo90s
S="$P/infra/standby"
ST=/var/lib/koop-watch
PRIMARY=82.148.244.248
SELF=85.198.67.48
WITNESS=195.133.81.121
DOWN_LIMIT="${KOOP_DOWN_LIMIT:-10}"
mkdir -p "$ST"
notify() { bash "$S/notify.sh" "$1"; }

[ -f "$P/.failover-done" ] && exit 0
[ -f "$ST/disabled" ] && exit 0
exec 9>"$ST/lock"
flock -n 9 || exit 0

n="$(cat "$ST/down" 2>/dev/null || echo 0)"
if curl -sk -m 8 --resolve "kooperativ.space:443:$PRIMARY" https://kooperativ.space/ready | grep -q '"ready"'; then
  [ "$n" -ge 4 ] && notify "Аеза снова отвечает (не отвечала около $((n / 2)) мин). Переключение не понадобилось."
  echo 0 > "$ST/down"
  rm -f "$ST/split-notified"
  # Заодно здоровье копии: реплика должна получать изменения с основного.
  rs="$(docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select coalesce((select status from pg_stat_wal_receiver), \$\$none\$\$)"' 2>/dev/null || echo error)"
  if [ "$rs" != streaming ]; then
    if [ ! -f "$ST/repl-notified" ] || [ -n "$(find "$ST/repl-notified" -mmin +180)" ]; then
      notify "Копия базы на Бегете не получает изменения с Аезы (статус: $rs). Игра работает, но резерв отстаёт."
      touch "$ST/repl-notified"
    fi
  else
    rm -f "$ST/repl-notified"
  fi
  exit 0
fi

n=$((n + 1))
echo "$n" > "$ST/down"
[ "$n" -eq 4 ] && notify "Аеза не отвечает 2 минуты. Если так продлится до 5 минут и Таймвеб подтвердит, переключу игру на Бегет."
[ "$n" -lt "$DOWN_LIMIT" ] && exit 0

w="$(timeout 45 ssh -i /root/.ssh/koop_witness -o BatchMode=yes -o ConnectTimeout=10 "root@$WITNESS" status 2>/dev/null)"
case "$w" in
  aeza=down*) ;;
  aeza=up*)
    [ -f "$ST/split-notified" ] || notify "Бегет не видит Аезу $((n / 2)) мин, но Таймвеб её видит. Порвалась связь, а не упал сервер. Не переключаю."
    touch "$ST/split-notified"
    exit 0
    ;;
  *)
    [ -f "$ST/split-notified" ] || notify "Бегет не видит ни Аезу, ни Таймвеб. Возможно, отрезан сам Бегет. Не переключаю."
    touch "$ST/split-notified"
    exit 0
    ;;
esac

notify "Аеза лежит $((n / 2)) мин, Таймвеб это подтверждает. Переключаю игру на Бегет."
if bash "$S/failover.sh" > "$ST/failover.log" 2>&1; then
  if bash "$S/dns-beget.sh" "$SELF" >> "$ST/failover.log" 2>&1; then
    dns="Домен переведён на Бегет, игроки переедут за несколько минут."
  else
    dns="Домен НЕ переключён: смени A-записи kooperativ.space, www и admin на $SELF."
  fi
  notify "Игра работает на Бегете. $dns Аезу после восстановления не включать как есть (см. infra/standby/README.md)."
else
  touch "$ST/disabled"
  notify "Переключение не удалось, сторож выключен, нужна ручная проверка. Конец журнала: $(tail -4 "$ST/failover.log" | tr '\n' ' ')"
fi
