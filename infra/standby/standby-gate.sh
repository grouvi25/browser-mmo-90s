#!/usr/bin/env bash
# Вход автовыкатки на резервный сервер (Beget). Ключ из GitHub прописан в authorized_keys
# с forced command на этот скрипт. Резерв только получает образы и код той же версии,
# что и основной; игра здесь не запускается, база приходит репликацией.
#   ping        — проверка связи
#   load        — docker load образов mmo90s-*:incoming из потока
#   stage <sha> — код на этот коммит, incoming -> latest (готово к failover.sh)
set -euo pipefail
P=/opt/mmo90s

case "${SSH_ORIGINAL_COMMAND:-}" in
  ping)
    echo ok
    ;;
  load)
    gunzip | docker load
    ;;
  stage\ *)
    sha="${SSH_ORIGINAL_COMMAND#stage }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Плохой коммит" >&2; exit 2; }
    if [ -f "$P/.failover-done" ]; then
      echo "Резерв уже работает как основной сервер, выкатывать сюда надо обычным deploy" >&2
      exit 3
    fi
    cd "$P"
    git fetch -q --depth 30 origin "$sha"
    git reset -q --hard "$sha"
    for s in backend worker frontend; do
      docker image inspect "mmo90s-$s:incoming" >/dev/null
      docker tag "mmo90s-$s:incoming" "mmo90s-$s:latest"
      docker rmi "mmo90s-$s:incoming" >/dev/null
    done
    docker image prune -f >/dev/null
    echo "резерв готов на $sha"
    ;;
  *)
    echo "Команда запрещена" >&2
    exit 2
    ;;
esac
