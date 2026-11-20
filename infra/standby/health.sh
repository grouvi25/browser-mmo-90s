#!/usr/bin/env bash
KOOP_SITE=kooperativ.space
KOOP_AEZA=82.148.244.248
KOOP_BEGET=85.198.67.48

ready_at() {
  local ip="$1"
  curl --noproxy '*' -fsS --max-time 8 --resolve "$KOOP_SITE:443:$ip" "https://$KOOP_SITE/ready" |
    jq -e '.status == "ready" and .checks.postgres == "ok" and .checks.redis == "ok"' >/dev/null
}

beget_ready() {
  local host service
  for service in postgres redis pgbouncer backend worker frontend; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "mmo90s-$service-1" 2>/dev/null)" = healthy ] || return 1
  done
  ready_at 127.0.0.1 || return 1
  for host in "$KOOP_SITE" "www.$KOOP_SITE" "admin.$KOOP_SITE"; do
    [ "$(curl --noproxy '*' -fsSL --max-time 8 --resolve "$host:443:127.0.0.1" \
      --resolve "$KOOP_SITE:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$host/")" = 200 ] || return 1
  done
}

postgres() {
  docker exec mmo90s-postgres-1 sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' _ "$1"
}
