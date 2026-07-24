#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FILENAME="mmo90s_${TIMESTAMP}.sql.gz"

cd "$PROJECT_DIR"
if [[ -f backend/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./backend/.env
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "==> Creating PostgreSQL backup: $FILENAME"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump --format=plain --no-owner --no-privileges \
  -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip -9 > "$BACKUP_DIR/$FILENAME"

test -s "$BACKUP_DIR/$FILENAME"
chmod 600 "$BACKUP_DIR/$FILENAME"
gzip -t "$BACKUP_DIR/$FILENAME"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mmo90s_*.sql.gz' \
  -mtime "+$RETENTION_DAYS" -delete

echo "==> Backup verified: $BACKUP_DIR/$FILENAME"
