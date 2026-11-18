#!/usr/bin/env bash
# «Машина времени» базы (18.11), часть 2: поднять базу на заданный момент и снять с неё дамп.
# Живую базу НЕ трогает: восстановление идёт во временном контейнере на 127.0.0.1:55432,
# результат — дамп /srv/pg-restore/mmo90s_<момент>.sql.gz, из которого берут нужное
# (одну таблицу, одного игрока или всё целиком — решает человек).
#
#   pitr-restore.sh "2026-11-18 14:31:05+03"
set -euo pipefail
TARGET="${1:?момент, например \"2026-11-18 14:31:05+03\"}"
BASE=/srv/pg-base
WAL=/srv/pg-wal
OUT=/srv/pg-restore
IMG=postgres:16-alpine
NAME=koop-pitr-restore

target_epoch="$(date -d "$TARGET" +%s)"
# Самая свежая полная копия, снятая раньше нужного момента.
pick=""
for dir in $(ls -1d "$BASE"/*/ | sort); do
  stamp="$(basename "$dir")"
  epoch="$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s)"
  [ -f "$dir/.done" ] && [ "$epoch" -lt "$target_epoch" ] && pick="$dir"
done
[ -n "$pick" ] || { echo "нет полной копии раньше $TARGET"; exit 1; }
echo "копия: $pick"

WORK="$(mktemp -d /srv/pg-restore-work.XXXXXX)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
install -d -m 700 -o 70 -g 70 "$WORK/data" "$OUT"
tar -xzf "$pick/base.tar.gz" -C "$WORK/data"
chown -R 70:70 "$WORK/data"; chmod 700 "$WORK/data"
touch "$WORK/data/recovery.signal"
cat >> "$WORK/data/postgresql.auto.conf" <<CONF
restore_command = 'cp /wal/%f %p 2>/dev/null || cp /wal/%f.partial %p'
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'
primary_conninfo = ''
CONF
rm -f "$WORK/data/standby.signal"

docker run -d --name "$NAME" --user 70:70 -v "$WORK/data:/var/lib/postgresql/data" -v "$WAL:/wal:ro" \
  -p 127.0.0.1:55432:5432 "$IMG" >/dev/null
for i in $(seq 1 120); do
  if docker exec "$NAME" psql -U "$(docker exec mmo90s-postgres-1 sh -c 'echo $POSTGRES_USER')" -d postgres -tAc "select not pg_is_in_recovery()" 2>/dev/null | grep -qx t; then break; fi
  sleep 2
done
USER_NAME="$(docker exec mmo90s-postgres-1 sh -c 'echo $POSTGRES_USER')"
DB_NAME="$(docker exec mmo90s-postgres-1 sh -c 'echo $POSTGRES_DB')"
docker exec "$NAME" psql -U "$USER_NAME" -d "$DB_NAME" -tAc "select not pg_is_in_recovery()" | grep -qx t \
  || { echo "база не поднялась до $TARGET"; docker logs --tail 30 "$NAME"; exit 1; }
FILE="$OUT/mmo90s_$(date -d "$TARGET" -u +%Y%m%d-%H%M%S).sql.gz"
docker exec "$NAME" pg_dump --format=plain --no-owner --no-privileges -U "$USER_NAME" "$DB_NAME" | gzip -9 > "$FILE"
gzip -t "$FILE"
echo "готово: $FILE (база на $TARGET)"
