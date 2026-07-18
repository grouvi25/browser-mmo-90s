#!/bin/bash
set -e

echo "==> Pulling latest changes..."
git pull origin main

echo "==> Building images..."
docker compose build

echo "==> Running migrations..."
docker compose run --rm backend npx prisma migrate deploy

echo "==> Restarting services..."
docker compose up -d

echo "==> Done! Game is live."
