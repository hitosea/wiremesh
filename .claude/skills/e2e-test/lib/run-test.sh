#!/bin/bash
# Run one device test and emit a per-key result block on stdout.
# Usage: run-test.sh <device_id> <device_name> <protocol> <line_id> <expected_csv>
# expected_csv format:  ifconfig.me=B,ip.me=C,icanhazip.com=D
# (key=letter, where letters A/B/C/D map to the four servers in servers.env)
#
# Stdout format (parsed by batch-test.sh):
#   == <key> ==
#   <ip-or-empty>
# Each test ends with the line:
#   == END ==
#
# Side effect: container `wm-test-d<device_id>` is removed before/after the run.

set -euo pipefail

DID=$1
DNAME=$2
PROTO=$3
LINE=$4
EXPECTED=$5

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/load-env.sh
. "$DIR/load-env.sh"

: "${WM_COOKIE_FILE:=/tmp/wm-cookies.txt}"
: "${WM_IMAGE:=$($DIR/build-image.sh)}"

WORK="/tmp/wm-test/d-$DID"
mkdir -p "$WORK"

CONFIG_JSON=$(curl -s -b "$WM_COOKIE_FILE" "$LOCAL_URL/api/devices/$DID/config")

declare -A URL_FOR_KEY=(
    [ifconfig.me]="https://ifconfig.me"
    [ip.me]="https://ip.me"
    [icanhazip.com]="https://icanhazip.com"
    [ip.sb]="https://api.ip.sb/ip"
    [pconline]="https://whois.pconline.com.cn/ipJson.jsp?ip=myip&json=true"
)

declare -A EXPECTED_MAP
IFS=',' read -ra PAIRS <<< "$EXPECTED"
for p in "${PAIRS[@]}"; do
    EXPECTED_MAP[${p%%=*}]=${p##*=}
done

# Build the per-key curl block. For pconline we extract the JSON "ip"
# field via grep+sed (ASCII), avoiding the GBK Python decode dance.
build_curl_block() {
    local proxy_arg=$1
    local block=""
    for k in "${!EXPECTED_MAP[@]}"; do
        local url="${URL_FOR_KEY[$k]}"
        if [ "$k" = "pconline" ]; then
            block+="echo \"== $k ==\"; curl --connect-timeout 15 --max-time 30 -s $proxy_arg \"$url\" 2>/dev/null | grep -oE '\"ip\":\"[^\"]+\"' | head -1 | sed 's/\"ip\":\"//;s/\"//' || echo; echo;"
        else
            block+="echo \"== $k ==\"; curl --connect-timeout 15 --max-time 30 -s $proxy_arg \"$url\" 2>/dev/null | tr -d '[:space:]' || echo; echo;"
        fi
    done
    printf '%s' "$block"
}

CONTAINER="wm-test-d$DID"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

case "$PROTO" in
    wireguard)
        echo "$CONFIG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['config'])" > "$WORK/wg.conf"
        DNS_SERVER=$(grep -oP '^DNS\s*=\s*\K[^\s]+' "$WORK/wg.conf" || true)
        sed -i '/^DNS =/d' "$WORK/wg.conf"
        DNS_VAL=${DNS_SERVER:-8.8.8.8}
        BLOCK=$(build_curl_block "")
        docker run --rm --name "$CONTAINER" --privileged \
            -v "$WORK/wg.conf:/etc/wireguard/wg0.conf" \
            "$WM_IMAGE" sh -c "
                wg-quick up wg0 >/dev/null 2>&1
                echo nameserver $DNS_VAL > /etc/resolv.conf
                sleep 2
                $BLOCK
            "
        ;;
    xray|xray-reality|xray-wstls)
        echo "$CONFIG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['config'])" > "$WORK/xray.json"
        BLOCK=$(build_curl_block "--proxy socks5h://127.0.0.1:1080")
        docker run --rm --name "$CONTAINER" \
            -v "$WORK/xray.json:/etc/xray.json:ro" \
            "$WM_IMAGE" sh -c "
                /usr/local/bin/xray -c /etc/xray.json > /tmp/xray.log 2>&1 &
                sleep 3
                $BLOCK
            "
        ;;
    socks5)
        PROXY=$(echo "$CONFIG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['proxyUrl'])")
        # Force socks5h:// so DNS resolution happens server-side.
        # ip.me etc. return bogus geo IPs to client-side lookups; the proxy
        # node's DNS gives correct answers.
        PROXY=${PROXY/socks5:\/\//socks5h://}
        BLOCK=$(build_curl_block "--proxy $PROXY")
        docker run --rm --name "$CONTAINER" "$WM_IMAGE" sh -c "$BLOCK"
        ;;
    *)
        echo "ERROR: unknown protocol $PROTO" >&2
        exit 1
        ;;
esac

echo "== END =="
