#!/usr/bin/env bash
# «Машина времени» базы (18.11), часть 1: полная копия раз в сутки (таймер koop-pitr-base).
# Вместе с журналом изменений, который непрерывно пишет koop-wal-receive (pg_receivewal,
# /srv/pg-wal), позволяет поднять базу на любую секунду после самой старой копии.
# Копии в /srv/pg-base/<дата>, держим 7; журнал старше самой старой копии удаляется.
set -euo pipefail
BASE=/srv/pg-base
WAL=/srv/pg-wal
KEEP=7
STAMP="$(date -u +%Y%m%d-%H%M%S)"
IMG=postgres:16-alpine

install -d -m 700 -o 70 -g 70 "$BASE/$STAMP"
docker run --rm --add-host host.docker.internal:host-gateway --env-file /etc/koop-wal.env \
  -v "$BASE/$STAMP:/base" --user 70:70 "$IMG" \
  pg_basebackup -h host.docker.internal -p 15432 -U replicator -D /base -Ft -z -X none --checkpoint=fast
test -s "$BASE/$STAMP/base.tar.gz"
echo "$STAMP" > "$BASE/$STAMP/.done"

# Старые копии и журнал до самой старой оставшейся копии.
ls -1d "$BASE"/*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf
OLDEST="$(ls -1d "$BASE"/*/ | sort | head -1)"
find "$WAL" -maxdepth 1 -type f ! -name '*.partial' ! -newer "$OLDEST" -mmin +60 -delete
echo "$(date '+%F %T') копия $STAMP, копий $(ls -1d "$BASE"/*/ | wc -l), журнал $(du -sh "$WAL" | cut -f1)" >> /var/log/koop-pitr.log
