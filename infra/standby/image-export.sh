#!/usr/bin/env bash
# Отдача выкаченной версии резерву (стоит на основном, forced command ключа koop_images резерва).
# Резерв сам забирает образы с основного: GitHub до резерва дотягивается ненадёжно,
# а основной рядом. Только чтение: отдаёт коммит и образы, ничего не меняет.
#   sha    — какой коммит сейчас выкачен
#   images — образы mmo90s-*:latest одним потоком (docker save | gzip)
set -euo pipefail
case "${SSH_ORIGINAL_COMMAND:-}" in
  sha)
    git -C /opt/mmo90s rev-parse HEAD
    ;;
  images)
    docker save mmo90s-backend:latest mmo90s-worker:latest mmo90s-frontend:latest | gzip -1
    ;;
  *)
    echo "Команда запрещена" >&2
    exit 2
    ;;
esac
