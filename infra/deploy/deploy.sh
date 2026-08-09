#!/bin/bash
# =============================================================
# VPS deploy script for mmo90s
# Usage: bash infra/deploy/deploy.sh [--first-run]
# IMPORTANT: Does NOT touch other projects on the server
# =============================================================
set -e

PROJECT_DIR="/opt/mmo90s"
REPO_URL="https://github.com/grouvi25/browser-mmo-90s.git"
NGINX_SITES="/etc/nginx/sites-enabled"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"

echo "================================================"
echo "  MMO 90s Deploy — $(date)"
echo "================================================"

# First run: clone repo
if [ "$1" = "--first-run" ]; then
    echo "[1/6] Cloning repository..."
    mkdir -p $PROJECT_DIR
    git clone $REPO_URL $PROJECT_DIR
    echo "      Done. Now edit $PROJECT_DIR/backend/.env and run again without --first-run"
    exit 0
fi

cd $PROJECT_DIR

echo "[1/6] Pulling latest code..."
git pull origin main

echo "[2/6] Building Docker images..."
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml build --no-cache

echo "[3/6] Running database migrations..."
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml run --rm backend npx prisma migrate deploy

echo "[4/6] Seeding database (safe, uses upsert)..."
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml run --rm backend npx tsx prisma/seed.ts

echo "[5/6] Restarting services..."
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --remove-orphans

echo "[6/6] Linking nginx vhost..."
if [ ! -f "$NGINX_SITES/mmo90s" ]; then
    ln -s $PROJECT_DIR/infra/nginx/vhost-vps.conf $NGINX_SITES/mmo90s
    nginx -t && nginx -s reload
    echo "      Nginx vhost enabled"
else
    nginx -t && nginx -s reload
    echo "      Nginx reloaded"
fi

echo ""
echo "✅ Deploy complete!"
echo "   Containers: $(docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml ps --format 'table {{.Name}}\t{{.Status}}' | grep mmo90s)"
