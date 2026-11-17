#!/usr/bin/env bash
# Переключение Кооператива на резервный сервер (запускается на резерве, Beget).
#
#   bash /opt/mmo90s/infra/standby/failover.sh            — только если основной не отвечает
#   bash /opt/mmo90s/infra/standby/failover.sh --force    — даже если отвечает (учебная тревога;
#                                                           основной перед этим остановить вручную)
#
# Что делает:
#   1. проверяет, что основной сервер (Aeza) действительно лежит, иначе отказывается:
#      две живые базы потом не склеить;
#   2. рвёт туннель к основному и делает реплику Postgres основной базой, Redis — основным;
#   3. продлевает срок хода во всех идущих боях, чтобы за время переезда никому
#      не засчитали пропуск и не заморозили;
#   4. запускает игру из уже загруженных образов и включает nginx с копией сертификатов;
#   5. проверяет игру. Домен переключает человек (DNS у Beget), скрипт печатает что сделать.
#
# После переключения бывший основной НЕЛЬЗЯ просто включить обратно: его база отстала.
# Возврат — отдельная процедура (см. infra/standby/README.md).
set -Eeuo pipefail
P=/opt/mmo90s
PRIMARY=82.148.244.248
SELF=85.198.67.48
SITE=kooperativ.space
C="docker compose -p mmo90s -f docker-compose.prod.yml -f docker-compose.vps.yml"
cd "$P"
stamp() { echo "== $(date +%H:%M:%S) $*"; }

if [ "${1:-}" != "--force" ]; then
  if curl -sk -m 8 --resolve "$SITE:443:$PRIMARY" "https://$SITE/ready" | grep -q '"ready"'; then
    echo "Основной сервер $PRIMARY отвечает. Переключение отменено, иначе будет две живые базы."
    echo "Для учебной тревоги сначала остановить игру на основном, потом запустить с --force."
    exit 2
  fi
fi

for s in backend worker frontend; do
  docker image inspect "mmo90s-$s:latest" >/dev/null || { echo "Нет образа mmo90s-$s:latest, запускать нечего"; exit 1; }
done

stamp "рву туннель к основному"
systemctl stop koop-tunnel 2>/dev/null || true

stamp "Postgres: реплика становится основной базой"
lag="$(docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select coalesce(extract(epoch from now()-pg_last_xact_replay_timestamp())::int, -1)"' || echo '?')"
echo "последняя запись с основного была $lag с назад"
docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select pg_promote(true, 60)"'
docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select pg_is_in_recovery()"' | grep -qx f

stamp "Redis: копия становится основным"
docker exec mmo90s-redis-1 redis-cli replicaof no one >/dev/null
docker exec mmo90s-redis-1 redis-cli info replication | grep -q 'role:master'

stamp "поднимаю базу, Redis и пул без резервных настроек"
$C up -d --no-build postgres redis pgbouncer
for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' mmo90s-pgbouncer-1 2>/dev/null)" = healthy ] && break
  sleep 2
done

stamp "продлеваю ходы в идущих боях"
$C run --rm --no-deps backend node -e '
const { prisma } = require("/app/dist/shared/db/prisma")
const { BattleRedis } = require("/app/dist/shared/db/redis")
;(async () => {
  const battles = await prisma.battle.findMany({ where: { status: "ACTIVE" }, select: { id: true } })
  let n = 0
  for (const b of battles) {
    const s = await BattleRedis.getState(b.id)
    if (!s || s.status !== "active") continue
    s.roundDeadline = Date.now() + 120000
    await BattleRedis.setState(b.id, s)
    n++
  }
  console.log("боёв идёт:", battles.length, "продлено:", n)
  await prisma.$disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })' 2>&1 | tail -2

stamp "запуск игры"
$C up -d --no-build --remove-orphans

stamp "nginx"
bash "$P/infra/standby/refresh-certs.sh"
ln -sf /etc/nginx/sites-available/kooperativ-main /etc/nginx/sites-enabled/kooperativ-main
ln -sf /etc/nginx/sites-available/kooperativ-admin /etc/nginx/sites-enabled/kooperativ-admin
nginx -t 2>&1 | tail -1
systemctl reload nginx

stamp "проверка игры"
for c in mmo90s-backend-1 mmo90s-worker-1 mmo90s-frontend-1; do
  for i in $(seq 1 30); do
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c" 2>/dev/null)" = healthy ] && break
    sleep 3
  done
  echo "$c: $(docker inspect -f '{{.State.Health.Status}}' "$c")"
done
curl -sk -m 15 --resolve "$SITE:443:127.0.0.1" "https://$SITE/ready"; echo

touch "$P/.failover-done"
stamp "ГОТОВО. Игра работает на резерве $SELF."
echo "Осталось переключить домен: A-записи kooperativ.space, www и admin -> $SELF (DNS в панели Beget)."
