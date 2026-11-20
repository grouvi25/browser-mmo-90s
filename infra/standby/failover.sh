#!/usr/bin/env bash
# Beget становится основным только после отзыва аренды Aeza. DNS меняет watch.sh.
set -euo pipefail
P=/opt/mmo90s
S="$(dirname "$(realpath "$0")")"
ST=/var/lib/koop-watch
source "$S/health.sh"
C=(docker compose -p mmo90s -f docker-compose.prod.yml -f docker-compose.vps.yml)
cd "$P"
stamp() { echo "== $(date +%H:%M:%S) $*"; }

check_nginx() (
  local sites
  sites="$(mktemp -d)"
  trap 'rm -rf -- "$sites"' EXIT
  cp -a /etc/nginx/sites-enabled/. "$sites/"
  ln -sfn /etc/nginx/sites-available/kooperativ-main "$sites/kooperativ-main"
  ln -sfn /etc/nginx/sites-available/kooperativ-admin "$sites/kooperativ-admin"
  unshare --mount --propagation private bash -ec '
    mount --bind "$1" /etc/nginx/sites-enabled
    nginx -t
  ' _ "$sites"
)

preflight() {
  local service image host available
  [ "$(df --output=avail -k "$P" | tail -1)" -gt 1048576 ]
  available="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
  [ "$available" -ge 700 ]
  for service in postgres redis; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "mmo90s-$service-1")" = healthy ] || return 1
  done
  for image in postgres:16-alpine redis:7-alpine edoburu/pgbouncer:latest \
      mmo90s-backend:latest mmo90s-worker:latest mmo90s-frontend:latest; do
    docker image inspect "$image" >/dev/null || return 1
  done
  "${C[@]}" config --quiet || return 1
  [ "$(postgres 'SELECT CASE WHEN pg_is_in_recovery() THEN NOT pg_is_wal_replay_paused() ELSE true END')" = t ] || return 1
  [ -s /etc/nginx/sites-available/kooperativ-main ] && [ -s /etc/nginx/sites-available/kooperativ-admin ] || return 1
  for host in "$KOOP_SITE" "admin.$KOOP_SITE"; do
    openssl x509 -in "/etc/nginx/koop-certs/$host/fullchain.pem" -noout -checkend 900 >/dev/null || return 1
    [ -s "/etc/nginx/koop-certs/$host/privkey.pem" ] || return 1
  done
  check_nginx
}

if [ "${1:-}" = --preflight ]; then preflight; exit; fi
[ "$#" -eq 0 ]
[ -e "$ST/promotion-approved" ]
stamp "Проверка резерва"
preflight

stamp "Остановка туннеля репликации"
systemctl disable --now koop-pitr-base.timer koop-wal-receive.service koop-tunnel.service

stamp "Повышение PostgreSQL и Redis"
role="$(postgres 'SELECT pg_is_in_recovery()')"
case "$role" in
  t) [ "$(postgres 'SELECT pg_promote(true, 60)')" = t ] ;;
  f) ;;
  *) exit 1 ;;
esac
[ "$(postgres 'SELECT pg_is_in_recovery()')" = f ]
docker exec mmo90s-redis-1 redis-cli replicaof no one >/dev/null
docker exec mmo90s-redis-1 redis-cli --raw info replication | grep -Fxq $'role:master\r'
"${C[@]}" up -d --no-build --pull never --wait --wait-timeout 90 postgres redis pgbouncer

if [ ! -e "$ST/battles-extended" ]; then
  stamp "Продление ходов в боях"
  "${C[@]}" run --rm --no-deps --pull never backend node -e '
const { prisma } = require("/app/dist/shared/db/prisma")
const { BattleRedis } = require("/app/dist/shared/db/redis")
;(async () => {
  const battles = await prisma.battle.findMany({ where: { status: "ACTIVE" }, select: { id: true } })
  for (const battle of battles) {
    const state = await BattleRedis.getState(battle.id)
    if (!state || state.status !== "active") continue
    state.roundDeadline = Math.max(state.roundDeadline || 0, Date.now() + 120000)
    await BattleRedis.setState(battle.id, state)
  }
  await prisma.$disconnect()
  process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })'
  touch "$ST/battles-extended"
fi

stamp "Запуск игры"
"${C[@]}" up -d --no-build --pull never --wait --wait-timeout 120
ln -sfn /etc/nginx/sites-available/kooperativ-main /etc/nginx/sites-enabled/kooperativ-main
ln -sfn /etc/nginx/sites-available/kooperativ-admin /etc/nginx/sites-enabled/kooperativ-admin
nginx -t
systemctl reload nginx

stamp "Проверка HTTPS на Beget"
beget_ready
touch "$P/.failover-done"
stamp "Beget готов принимать игроков"
