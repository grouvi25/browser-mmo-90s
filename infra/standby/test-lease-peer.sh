#!/usr/bin/env bash
# Проверяет переключение источника аренды и ограждение перед повышением реплики.
set -euo pipefail
S="$(cd -- "$(dirname -- "$0")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/bin" "$fixture/state" "$fixture/project"
export PATH="$fixture/bin:$PATH" FIXTURE="$fixture"

for script in lease-primary lease-peer watch; do
  sed -e "s|/var/lib/koop-watch|$fixture/state|g" \
    -e "s|/etc/koop-lease-network|$fixture/network|g" \
    -e "s|/opt/mmo90s|$fixture/project|g" "$S/$script.sh" > "$fixture/$script.sh"
done
cat > "$fixture/network" <<'EOF'
KOOP_BRIDGE=br-0123456789ab
KOOP_SUBNET=172.18.0.0/16
EOF
cat > "$fixture/health.sh" <<'EOF'
KOOP_AEZA=82.148.244.248
KOOP_BEGET=85.198.67.48
ready_at() { return 1; }
beget_ready() { return 0; }
postgres() { printf '%s\n' "${PG_RECOVERY:-t}"; }
EOF
cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'role:%s\r\n' "${REDIS_ROLE:-slave}"
EOF
cat > "$fixture/bin/ssh" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " = *' root@85.198.67.48 '* ]]; then
  touch "$FIXTURE/peer-called"
  SSH_ORIGINAL_COMMAND=renew bash "$FIXTURE/lease-peer.sh" --renew
  exit
fi
case "${*: -1}" in
  renew) [ "${WITNESS:-unreachable}" != unreachable ] && echo "$WITNESS" ;;
  status) [[ " $* " != *' /root/.ssh/koop_witness '* ]] && echo open || echo 'aeza=down role=unknown' ;;
  freeze) echo fenced ;;
esac
EOF
cat > "$fixture/bin/nft" <<'EOF'
#!/usr/bin/env bash
cat > "$FIXTURE/nft.input"
EOF
cat > "$fixture/failover.sh" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" = --preflight ]] || touch "$FIXTURE/project/.failover-done"
EOF
cat > "$fixture/dns-cloudflare.py" <<'EOF'
pass
EOF
printf '#!/usr/bin/env bash\ntrue\n' > "$fixture/notify.sh"
chmod +x "$fixture/bin/"*

# Недоступность свидетеля не закрывает Aeza, если живой Beget остаётся репликой.
bash "$fixture/lease-primary.sh" --renew
grep -q '^add element inet koop_lease active' "$fixture/nft.input"
test -e "$fixture/peer-called"
rm "$fixture/peer-called"

# Явный отзыв Timeweb не разрешает обход к Beget.
WITNESS=revoked bash "$fixture/lease-primary.sh" --renew
if grep -q '^add element' "$fixture/nft.input"; then exit 1; fi
test ! -e "$fixture/peer-called"

if PG_RECOVERY=f bash "$fixture/lease-primary.sh" --renew; then exit 1; fi
if REDIS_ROLE=master bash "$fixture/lease-primary.sh" --renew; then exit 1; fi
if SSH_ORIGINAL_COMMAND=freeze bash "$fixture/lease-peer.sh" --renew; then exit 1; fi
(
  flock -x 9
  if SSH_ORIGINAL_COMMAND=renew bash "$fixture/lease-peer.sh" --renew; then exit 1; fi
) 9>"$fixture/state/lock"

# Даже если Timeweb уже подтвердил ограждение, ждём истечения выдачи Beget.
now="$(date +%s)"
printf '%s\n' "$((now - 400))" > "$fixture/state/down-since"
printf '%s\n' "$((now - 450))" > "$fixture/state/replica-ok"
bash "$fixture/watch.sh"
test -s "$fixture/state/peer-frozen"
test ! -e "$fixture/state/promotion-approved"
test "$(SSH_ORIGINAL_COMMAND=renew bash "$fixture/lease-peer.sh" --renew)" = revoked

read -r uptime _ < /proc/uptime
printf '%s %s\n' "$(cat /proc/sys/kernel/random/boot_id)" "$((${uptime%.*} - 150))" > "$fixture/state/peer-frozen"
bash "$fixture/watch.sh"
test -e "$fixture/state/promotion-approved"
test -e "$fixture/state/dns-done"
echo 'Peer lease and promotion checks passed'
