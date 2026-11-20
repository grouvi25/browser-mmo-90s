#!/usr/bin/env bash
# Вход автовыкатки на резервный сервер (Beget). Ключ из GitHub прописан в authorized_keys
# с forced command на этот скрипт. Резерв только получает образы и код той же версии,
# что и основной; игра здесь не запускается, база приходит репликацией.
#   ping        — проверка связи
#   load        — docker load образов mmo90s-*:incoming из потока
#   stage <sha> — код на этот коммит, incoming -> latest (готово к failover.sh)
#   pull <sha>  — забрать образы и коммит с основного (основной путь с 18.11)
set -euo pipefail
P=/opt/mmo90s
ST=/var/lib/koop-watch

lock_replica() {
  exec 9>"$ST/lock"
  flock -w 60 9
  if [ -e "$ST/promotion-approved" ] || [ -e "$P/.failover-done" ]; then
    echo "Beget уже повышается или работает как основной сервер" >&2
    exit 3
  fi
}

case "${SSH_ORIGINAL_COMMAND:-}" in
  ping)
    echo ok
    ;;
  load)
    gunzip | docker load
    ;;
  pull\ *)
    # Забрать выкаченную версию с основного: образы и коммит (GitHub даёт только команду).
    sha="${SSH_ORIGINAL_COMMAND#pull }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Плохой коммит" >&2; exit 2; }
    lock_replica
    A="ssh -i /root/.ssh/koop_images -o BatchMode=yes -o ConnectTimeout=15 root@82.148.244.248"
    live="$($A sha)"
    [ "$live" = "$sha" ] || { echo "На основном выкачен $live, а не $sha" >&2; exit 4; }
    $A images | gunzip | docker load | tail -3
    cd "$P"
    git fetch -q --depth 30 origin "$sha"
    git reset -q --hard "$sha"
    docker image prune -f >/dev/null
    echo "резерв готов на $sha"
    ;;
  stage\ *)
    sha="${SSH_ORIGINAL_COMMAND#stage }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Плохой коммит" >&2; exit 2; }
    lock_replica
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
