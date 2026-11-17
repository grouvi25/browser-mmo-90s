#!/usr/bin/env bash
# Сообщение владельцу в Telegram ботом Grouvi Nox (только sendMessage, с Nox не конфликтует).
# Токен и чат в /etc/koop-notify.env (KOOP_TG_TOKEN, KOOP_TG_CHAT), в репозитории их нет.
#   notify.sh "текст"
set -uo pipefail
[ -r /etc/koop-notify.env ] || exit 0
. /etc/koop-notify.env
[ -n "${KOOP_TG_TOKEN:-}" ] && [ -n "${KOOP_TG_CHAT:-}" ] || exit 0
text="Кооператив, $(hostname): $1"
curl -s -m 15 -o /dev/null "https://api.telegram.org/bot${KOOP_TG_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${KOOP_TG_CHAT}" --data-urlencode "text=${text}" || true
