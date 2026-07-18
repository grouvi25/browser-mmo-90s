#!/bin/bash
set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
FILENAME="mmo90s_backup_$TIMESTAMP.sql"

mkdir -p $BACKUP_DIR

echo "==> Creating backup $FILENAME..."
docker compose exec postgres pg_dump -U postgres mmo90s > "$BACKUP_DIR/$FILENAME"

echo "==> Backup saved to $BACKUP_DIR/$FILENAME"
