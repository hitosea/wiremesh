import { NextResponse } from "next/server";

export async function GET() {
  const script = `#!/bin/bash
#
# WireMesh Agent Uninstall Script
# Generated: ${new Date().toISOString()}
#

set -e

# ============================================================
# Colors and helpers
# ============================================================
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

info()  { echo -e "\${BLUE}[INFO]\${NC}  \$1"; }
ok()    { echo -e "\${GREEN}[OK]\${NC}    \$1"; }
warn()  { echo -e "\${YELLOW}[WARN]\${NC}  \$1"; }
fail()  { echo -e "\${RED}[FAIL]\${NC}  \$1"; exit 1; }

echo ""
echo "======================================"
echo "  WireMesh Agent Uninstaller"
echo "======================================"
echo ""

# ============================================================
# Phase 1: Root check
# ============================================================
info "Phase 1: Checking environment..."

if [ "$(id -u)" -ne 0 ]; then
  fail "This script must be run as root"
fi
ok "Running as root"

echo ""

# ============================================================
# Phase 2: Stop and disable services
# ============================================================
info "Phase 2: Stopping and disabling services..."

if systemctl is-active wiremesh-agent &>/dev/null; then
  systemctl stop wiremesh-agent
  ok "wiremesh-agent stopped"
else
  info "wiremesh-agent is not running"
fi

if systemctl is-enabled wiremesh-agent &>/dev/null 2>&1; then
  systemctl disable wiremesh-agent >/dev/null 2>&1
  ok "wiremesh-agent disabled"
fi

if systemctl is-active wiremesh-xray &>/dev/null; then
  systemctl stop wiremesh-xray
  ok "wiremesh-xray stopped"
else
  info "wiremesh-xray is not running"
fi

if systemctl is-enabled wiremesh-xray &>/dev/null 2>&1; then
  systemctl disable wiremesh-xray >/dev/null 2>&1
  ok "wiremesh-xray disabled"
fi

echo ""

# ============================================================
# Phase 3: Remove WireGuard interfaces
# ============================================================
info "Phase 3: Removing WireGuard interfaces..."

# Remove all wm-tun* interfaces
for IFACE in $(ip -o link show 2>/dev/null | grep -oP 'wm-tun\\d+' || true); do
  ip link set down "\$IFACE" 2>/dev/null || true
  ip link del "\$IFACE" 2>/dev/null || true
  ok "Removed interface \$IFACE"
done

# Remove wm-wg0
if ip link show wm-wg0 &>/dev/null; then
  ip link set down wm-wg0 2>/dev/null || true
  ip link del wm-wg0 2>/dev/null || true
  ok "Removed interface wm-wg0"
else
  info "Interface wm-wg0 not found"
fi

echo ""

# ============================================================
# Phase 4: Clean iptables rules
# ============================================================
info "Phase 4: Cleaning iptables rules..."

clean_iptables_chain() {
  local TABLE="\$1"
  local CHAIN="\$2"
  while iptables -t "\$TABLE" -L "\$CHAIN" --line-numbers -n 2>/dev/null | grep -q 'wm-'; do
    LINE=$(iptables -t "\$TABLE" -L "\$CHAIN" --line-numbers -n 2>/dev/null | grep 'wm-' | head -1 | awk '{print \$1}')
    if [ -n "\$LINE" ]; then
      iptables -t "\$TABLE" -D "\$CHAIN" "\$LINE" 2>/dev/null || break
    else
      break
    fi
  done
}

clean_iptables_chain filter FORWARD
ok "Cleaned filter FORWARD"

clean_iptables_chain nat POSTROUTING
ok "Cleaned nat POSTROUTING"

clean_iptables_chain mangle PREROUTING
ok "Cleaned mangle PREROUTING"

clean_iptables_chain mangle OUTPUT
ok "Cleaned mangle OUTPUT"

echo ""

# ============================================================
# Phase 5: Clean ip rules and routing tables
# ============================================================
info "Phase 5: Cleaning ip rules and routing tables..."

# Helper: flush a routing table if it has any routes
flush_table() {
  local TABLE="\$1"
  if ip route show table "\$TABLE" 2>/dev/null | grep -q .; then
    ip route flush table "\$TABLE" 2>/dev/null || true
  fi
}

# Tables 101-199: device routes
for T in $(seq 101 199); do flush_table "\$T"; done
ok "Flushed device route tables (101-199)"

# Tables 201-299: relay routes
for T in $(seq 201 299); do flush_table "\$T"; done
ok "Flushed relay route tables (201-299)"

# Tables 41001-41100: branch fwmark
for T in $(seq 41001 41100); do flush_table "\$T"; done
ok "Flushed branch fwmark tables (41001-41100)"

# Tables 42001-42099: Xray fwmark
for T in $(seq 42001 42099); do flush_table "\$T"; done
ok "Flushed Xray fwmark tables (42001-42099)"

# Remove ip rules for above tables
for T in $(seq 101 199) $(seq 201 299) $(seq 41001 41100) $(seq 42001 42099); do
  while ip rule show 2>/dev/null | grep -q "lookup \$T\\b"; do
    ip rule del lookup "\$T" 2>/dev/null || break
  done
done
ok "Removed ip rules for WireMesh tables"

# Remove default branch rule at priority 32000
while ip rule show priority 32000 2>/dev/null | grep -q .; do
  ip rule del priority 32000 2>/dev/null || break
done
ok "Removed ip rule priority 32000 (default branch)"

echo ""

# ============================================================
# Phase 6: Clean ipsets
# ============================================================
info "Phase 6: Cleaning ipsets..."

if command -v ipset &>/dev/null; then
  for SET in $(ipset list -n 2>/dev/null | grep '^wm-' || true); do
    ipset destroy "\$SET" 2>/dev/null || true
    ok "Destroyed ipset \$SET"
  done
  ok "ipsets cleaned"
else
  info "ipset not installed, skipping"
fi

echo ""

# ============================================================
# Phase 7: Restore sysctl
# ============================================================
info "Phase 7: Restoring sysctl..."

if [ -f /etc/sysctl.d/99-wiremesh.conf ]; then
  rm -f /etc/sysctl.d/99-wiremesh.conf
  ok "Removed /etc/sysctl.d/99-wiremesh.conf"
else
  info "/etc/sysctl.d/99-wiremesh.conf not found"
fi

DOCKER_RUNNING=false
if systemctl is-active docker &>/dev/null || systemctl is-active containerd &>/dev/null; then
  DOCKER_RUNNING=true
fi

if [ "\$DOCKER_RUNNING" = true ]; then
  warn "Docker/containerd is running — keeping ip_forward=1 to avoid breaking containers"
  warn "To disable IP forwarding manually run: sysctl -w net.ipv4.ip_forward=0"
else
  sysctl -w net.ipv4.ip_forward=0 >/dev/null
  ok "IP forwarding disabled"
fi

echo ""

# ============================================================
# Phase 8: Remove files
# ============================================================
info "Phase 8: Removing WireMesh files..."

rm -f /etc/systemd/system/wiremesh-agent.service
ok "Removed wiremesh-agent.service"

rm -f /etc/systemd/system/wiremesh-xray.service
ok "Removed wiremesh-xray.service"

rm -rf /etc/wiremesh/
ok "Removed /etc/wiremesh/"

rm -f /usr/local/bin/wiremesh-agent
ok "Removed /usr/local/bin/wiremesh-agent"

rm -f /usr/local/bin/wiremesh-xray
ok "Removed /usr/local/bin/wiremesh-xray"

systemctl daemon-reload
ok "systemd daemon reloaded"

echo ""

# ============================================================
# Summary
# ============================================================
echo "======================================"
echo -e "  \${GREEN}Uninstall complete!\${NC}"
echo "======================================"
echo ""
echo "  Removed:"
echo "    - wiremesh-agent and wiremesh-xray services"
echo "    - WireGuard interfaces (wm-wg0, wm-tun*)"
echo "    - iptables rules (wm-* comments)"
echo "    - ip rules and routing tables"
echo "    - ipsets (wm-*)"
echo "    - /etc/wiremesh/ configuration directory"
echo "    - /usr/local/bin/wiremesh-agent"
echo "    - /usr/local/bin/wiremesh-xray"
echo ""
echo "  NOT removed (may be used by other software):"
echo "    - wireguard / wireguard-tools package"
echo "    - iptables package"
echo "    - ipset package"
echo ""
`;

  return new NextResponse(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
