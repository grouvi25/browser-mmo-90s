#!/usr/bin/env bash
# На Aeza правила ядра прекращают доступ к сети игры даже при остановленном таймере.
set -euo pipefail
source /etc/koop-lease-network
[[ "$KOOP_BRIDGE" =~ ^br-[a-f0-9]{12}$ ]]
[[ "$KOOP_SUBNET" =~ ^[0-9.]+/[0-9]+$ ]]
witness=195.133.81.121

clear_lease() {
  nft -f - <<'NFT'
flush set inet koop_lease active
flush set bridge koop_lease active
NFT
}

case "${1:-}" in
  --init)
    # Загружается до Docker. Один атомарный пакет заменяет обе таблицы.
    nft -f - <<NFT
add table inet koop_lease
add table bridge koop_lease
delete table inet koop_lease
delete table bridge koop_lease
table inet koop_lease {
  set active { type ifname; flags timeout; }
  chain guard {
    iifname @active accept
    oifname @active accept
    iifname "$KOOP_BRIDGE" drop
    oifname "$KOOP_BRIDGE" drop
    ip saddr $KOOP_SUBNET drop
    ip daddr $KOOP_SUBNET drop
  }
  chain input { type filter hook input priority -50; policy accept; jump guard; }
  chain output { type filter hook output priority -50; policy accept; jump guard; }
  chain forward { type filter hook forward priority -50; policy accept; jump guard; }
}
table bridge koop_lease {
  set active { type ifname; flags timeout; }
  chain forward {
    type filter hook forward priority -300; policy accept;
    meta ibrname @active accept
    meta obrname @active accept
    meta ibrname "$KOOP_BRIDGE" drop
    meta obrname "$KOOP_BRIDGE" drop
    ip saddr $KOOP_SUBNET drop
    ip daddr $KOOP_SUBNET drop
  }
}
NFT
    ;;
  --renew)
    read -r started _ < /proc/uptime
    answer="$(timeout -k 2 9 ssh -n -i /root/.ssh/koop_lease -o BatchMode=yes \
      -o ConnectTimeout=5 -o StrictHostKeyChecking=yes "root@$witness" renew)" || exit 1
    case "$answer" in
      revoked) clear_lease; exit 0 ;;
      granted) ;;
      *) exit 1 ;;
    esac
    read -r now _ < /proc/uptime
    left="$((90 - (${now%.*} - ${started%.*})))"
    [ "$left" -ge 80 ]
    nft -f - <<NFT
flush set inet koop_lease active
flush set bridge koop_lease active
add element inet koop_lease active { "$KOOP_BRIDGE" timeout ${left}s }
add element bridge koop_lease active { "$KOOP_BRIDGE" timeout ${left}s }
NFT
    ;;
  --check)
    network="$(docker network inspect mmo90s_network --format '{{.Id}} {{(index .IPAM.Config 0).Subnet}}')"
    read -r id subnet <<< "$network"
    [ "br-${id:0:12}" = "$KOOP_BRIDGE" ] && [ "$subnet" = "$KOOP_SUBNET" ]
    nft get element inet koop_lease active "{ \"$KOOP_BRIDGE\" }" >/dev/null
    nft get element bridge koop_lease active "{ \"$KOOP_BRIDGE\" }" >/dev/null
    ;;
  *) exit 2 ;;
esac
