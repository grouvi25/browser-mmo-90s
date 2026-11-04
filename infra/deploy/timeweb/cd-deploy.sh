#!/usr/bin/env bash
# Выкат на сервер Timeweb. Сервер чужой и на нём живут другие сайты, поэтому здесь нет:
#   сборки образов (их собирает GitHub), docker prune, правок nginx, ufw и sshd.
# Трогаем только /opt/mmo90s, /opt/mmo90s-tools и свои контейнеры и образы mmo90s-*.
# Правки этого файла вступают в силу после ручного копирования в /opt/mmo90s-tools.
set -Eeuo pipefail
SHA="$1"
T=/opt/mmo90s-tools
P=/opt/mmo90s
SITE=https://kooperativ.space
SERVICES="backend worker frontend"
C="docker compose -p mmo90s -f docker-compose.prod.yml -f docker-compose.vps.yml"
cd "$P"

stamp() { echo "== $(date +%H:%M:%S) $*"; }
PREV_SHA="$(git rev-parse HEAD)"
SWAPPED=0
OLD_ROLLBACK=""

on_error() {
  trap - ERR
  stamp "ОШИБКА, возвращаю прошлую версию"
  git reset --hard "$PREV_SHA" >/dev/null
  if [ "$SWAPPED" = 1 ]; then
    for s in $SERVICES; do docker tag "mmo90s-$s:rollback" "mmo90s-$s:latest"; done
    $C up -d --no-build
    stamp "Прошлая версия запущена. База не откатывается, это решается вручную."
  fi
  echo failed > "$T/cd.status"
  exit 1
}
trap on_error ERR

stamp "проверка сервера"
for s in $SERVICES; do docker image inspect "mmo90s-$s:incoming" >/dev/null; done
disk="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
mem="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
echo "диск ${disk}%, свободно памяти ${mem} МБ"
[ "$disk" -lt 90 ]
[ "$mem" -ge 350 ]

stamp "код $SHA"
git fetch --depth 30 origin "$SHA"
git reset --hard "$SHA"

stamp "копия базы"
bash infra/deploy/backup.sh

stamp "подмена образов"
for s in $SERVICES; do
  old="$(docker image inspect -f '{{.Id}}' "mmo90s-$s:rollback" 2>/dev/null || true)"
  OLD_ROLLBACK="$OLD_ROLLBACK $old"
  docker tag "mmo90s-$s:latest" "mmo90s-$s:rollback"
  docker tag "mmo90s-$s:incoming" "mmo90s-$s:latest"
done
SWAPPED=1

stamp "миграции"
$C run --rm --no-deps backend npx prisma migrate deploy 2>&1 | tail -3
stamp "сид"
$C run --rm --no-deps backend npx tsx prisma/seed.ts 2>&1 | tail -4

stamp "запуск"
$C up -d --no-build --remove-orphans

stamp "проверка игры"
wait_healthy() {
  local status i
  for i in $(seq 1 24); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$1" 2>/dev/null || echo missing)"
    if [ "$status" = healthy ]; then return 0; fi
    if [ "$status" = unhealthy ]; then break; fi
    sleep 5
  done
  echo "$1: $status" >&2
  docker logs --tail=60 "$1" 2>&1 | cut -c1-200 >&2 || true
  return 1
}
wait_healthy mmo90s-backend-1
wait_healthy mmo90s-frontend-1
wait_healthy mmo90s-worker-1
curl --fail --silent --max-time 15 "$SITE/" >/dev/null
curl --fail --silent --max-time 15 "$SITE/ready" | grep -q '"status":"ready"'

stamp "дымовой тест"
export SMOKE_PASSWORD SMOKE_BASE_URL="$SITE"
SMOKE_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
$C run --rm --no-deps -e SMOKE_PASSWORD -e SMOKE_BASE_URL backend node dist/scripts/production-auth-smoke.js 2>&1 | tail -5 | cut -c1-200
unset SMOKE_PASSWORD
[ -z "${CD_TEST_FAIL:-}" ]

trap - ERR
stamp "уборка своих образов"
for s in $SERVICES; do docker rmi "mmo90s-$s:incoming" >/dev/null 2>&1 || true; done
# Образ, из которого только что сделан новый откат, остаётся.
KEEP="$(for s in $SERVICES; do docker image inspect -f '{{.Id}}' "mmo90s-$s:rollback"; done)"
for id in $OLD_ROLLBACK; do
  if ! grep -qxF "$id" <<< "$KEEP"; then docker rmi "$id" >/dev/null 2>&1 || true; fi
done

stamp "соседние сайты"
while read -r n old; do
  code="$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve "$n:443:127.0.0.1" "https://$n/" || true)"
  echo "$n $old -> $code"
done < "$T/neighbors-before.txt"

echo ok > "$T/cd.status"
stamp "ГОТОВО $SHA"
