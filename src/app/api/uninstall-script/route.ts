import { NextResponse } from "next/server";
import {
  DEVICE_TABLE_START, DEVICE_TABLE_END,
  RELAY_TABLE_START, RELAY_TABLE_END,
  BRANCH_MARK_START, BRANCH_MARK_END,
  XRAY_MARK_START, XRAY_MARK_END,
  DEFAULT_BRANCH_PRIORITY,
} from "@/lib/routing-constants";

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

# Log output
LOG_FILE="/var/log/wiremesh-uninstall.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== WireMesh uninstall started at $(date) ==="

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

if systemctl is-enabled wiremesh-agent &>/dev/null 2>&1; then
  systemctl disable wiremesh-agent >/dev/null 2>&1
  ok "wiremesh-agent disabled"
fi

if systemctl is-active wiremesh-agent &>/dev/null; then
  systemctl stop wiremesh-agent 2>/dev/null || true
  ok "wiremesh-agent stopped"
else
  info "wiremesh-agent is not running"
fi

if systemctl is-enabled wiremesh-xray &>/dev/null 2>&1; then
  systemctl disable wiremesh-xray >/dev/null 2>&1
  ok "wiremesh-xray disabled"
fi

if systemctl is-active wiremesh-xray &>/dev/null; then
  systemctl stop wiremesh-xray 2>/dev/null || true
  ok "wiremesh-xray stopped"
else
  info "wiremesh-xray is not running"
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

for TABLE in filter nat mangle; do
  if iptables-save -t "\$TABLE" 2>/dev/null | grep -q 'wm-'; then
    iptables-save -t "\$TABLE" | grep -v 'wm-' | iptables-restore -T "\$TABLE" 2>/dev/null || true
    ok "Cleaned wm- rules from \$TABLE table"
  fi
done

echo ""

# ============================================================
# Phase 5: Clean ip rules and routing tables
# ============================================================
info "Phase 5: Cleaning ip rules and routing tables..."

# Remove ip rules FIRST (before flushing tables) to avoid blackholing traffic.
# Strategy: query actual ip rules, extract table numbers in WireMesh ranges, delete them.
# This avoids slow brute-force iteration over thousands of table numbers.

# WireMesh table/priority ranges (interpolated from src/lib/routing-constants.ts):
#   Device:  ${DEVICE_TABLE_START}-${DEVICE_TABLE_END}
#   Relay:   ${RELAY_TABLE_START}-${RELAY_TABLE_END}
#   Branch:  ${BRANCH_MARK_START}-${BRANCH_MARK_END}
#   Xray:    ${XRAY_MARK_START}-${XRAY_MARK_END}
#   Default: ${DEFAULT_BRANCH_PRIORITY}

is_wm_table() {
  local T="\$1"
  if [ "\$T" -ge ${DEVICE_TABLE_START} ] && [ "\$T" -le ${DEVICE_TABLE_END} ]; then return 0; fi
  if [ "\$T" -ge ${RELAY_TABLE_START} ] && [ "\$T" -le ${RELAY_TABLE_END} ]; then return 0; fi
  if [ "\$T" -ge ${BRANCH_MARK_START} ] && [ "\$T" -le ${BRANCH_MARK_END} ]; then return 0; fi
  if [ "\$T" -ge ${XRAY_MARK_START} ] && [ "\$T" -le ${XRAY_MARK_END} ]; then return 0; fi
  if [ "\$T" -eq ${DEFAULT_BRANCH_PRIORITY} ]; then return 0; fi
  return 1
}

# Step 1: Remove ip rules pointing to WireMesh tables
ip rule show 2>/dev/null | grep -oE 'lookup [0-9]+' | awk '{print \$2}' | sort -un | while read T; do
  if is_wm_table "\$T"; then
    while ip rule del lookup "\$T" 2>/dev/null; do true; done
  fi
done

# Also remove default branch rule by priority
while ip rule del priority ${DEFAULT_BRANCH_PRIORITY} 2>/dev/null; do true; done
ok "Removed WireMesh ip rules"

# Step 2: Flush routing tables (safe now — no ip rules point to them)
for T in \$(ip route show table all 2>/dev/null | grep -oE 'table [0-9]+' | awk '{print \$2}' | sort -un); do
  if is_wm_table "\$T"; then
    ip route flush table "\$T" 2>/dev/null || true
  fi
done
ok "Flushed WireMesh routing tables"

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
# Clean up logs (unless --keep-logs)
if [ "\${1:-}" != "--keep-logs" ]; then
  rm -f /var/log/wiremesh-install.log
  rm -f /var/log/wiremesh-uninstall.log
fi

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
