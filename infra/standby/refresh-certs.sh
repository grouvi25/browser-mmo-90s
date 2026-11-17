#!/usr/bin/env bash
# Готовит nginx резерва к переключению, ничего не включая:
#   - достаёт свежие сертификаты kooperativ.space и admin.kooperativ.space из последнего
#     архива бэкапа основного сервера (/srv/backups/aeza, забирает backup-pull-aeza);
#   - собирает сайты kooperativ-main и kooperativ-admin из vhost'ов репозитория
#     с путями к этим копиям сертификатов.
# Сайты кладутся в sites-available; включает их failover.sh.
# Сертификаты продлевает основной сервер, поэтому здесь своего certbot для них нет.
set -euo pipefail
P=/opt/mmo90s
CERTS=/etc/nginx/koop-certs
ARCH="$(ls -1t /srv/backups/aeza/aeza-*.tar.gz 2>/dev/null | head -1)"
[ -n "$ARCH" ] || { echo "нет архивов основного в /srv/backups/aeza"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCH" -C "$TMP" --wildcards 'etc/letsencrypt/live/*kooperativ.space*' 'etc/letsencrypt/archive/*kooperativ.space*' 2>/dev/null || true
for d in kooperativ.space admin.kooperativ.space; do
  src="$TMP/etc/letsencrypt/live/$d"
  [ -f "$src/fullchain.pem" ] || { echo "в $ARCH нет сертификата $d"; exit 1; }
  install -d -m 700 "$CERTS/$d"
  cp -L "$src/fullchain.pem" "$CERTS/$d/fullchain.pem"
  cp -L "$src/privkey.pem" "$CERTS/$d/privkey.pem"
  chmod 600 "$CERTS/$d/privkey.pem"
  echo "$d до $(openssl x509 -enddate -noout -in "$CERTS/$d/fullchain.pem" | cut -d= -f2) (из $(basename "$ARCH"))"
done

sed -e "s#/etc/letsencrypt/live/kooperativ.space/#$CERTS/kooperativ.space/#" \
    -e '0,/server_name kooperativ.space www.kooperativ.space;/s##server_name kooperativ.space www.kooperativ.space;\n    location /.well-known/acme-challenge/ { root /var/www/certbot; }#' \
    "$P/infra/nginx/vhost-vps.conf" > /etc/nginx/sites-available/kooperativ-main
sed -e "s#/etc/letsencrypt/live/admin.kooperativ.space/#$CERTS/admin.kooperativ.space/#" \
    "$P/infra/nginx/vhost-admin.conf" > /etc/nginx/sites-available/kooperativ-admin
mkdir -p /var/www/certbot
echo "сайты kooperativ-main и kooperativ-admin готовы в sites-available"
