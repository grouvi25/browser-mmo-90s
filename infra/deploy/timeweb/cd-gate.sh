#!/usr/bin/env bash
# Вход автовыкатки на сервер. Ключ из GitHub прописан в authorized_keys с forced command,
# поэтому этот скрипт принимает только три команды и не даёт выполнить что-то другое.
set -euo pipefail
T=/opt/mmo90s-tools

case "${SSH_ORIGINAL_COMMAND:-}" in
  ping)
    echo ok
    ;;
  load)
    gunzip | docker load
    ;;
  deploy\ *)
    sha="${SSH_ORIGINAL_COMMAND#deploy }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Плохой коммит" >&2; exit 2; }
    rm -f "$T/cd.status"
    # Выкат живёт отдельно от SSH: при обрыве связи он доедет или откатится сам.
    setsid nohup flock -n "$T/cd.lock" bash "$T/cd-deploy.sh" "$sha" > "$T/cd.log" 2>&1 < /dev/null &
    tail --pid=$! -n +1 -f "$T/cd.log"
    [ "$(cat "$T/cd.status" 2>/dev/null)" = ok ]
    ;;
  *)
    echo "Команда запрещена" >&2
    exit 2
    ;;
esac
