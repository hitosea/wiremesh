import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "无效的节点 ID");

  const node = db
    .select()
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();

  if (!node) return error("NOT_FOUND", "节点不存在");

  // Allow access via agentToken query param (for curl one-liner)
  const token = request.nextUrl.searchParams.get("token");
  const hasSession = request.cookies.get("token")?.value;
  if (!hasSession && token !== node.agentToken) {
    return error("UNAUTHORIZED", "无权访问");
  }

  let wgPrivateKey: string;
  try {
    wgPrivateKey = decrypt(node.wgPrivateKey);
  } catch {
    return error("INTERNAL_ERROR", "解密私钥失败");
  }

  const serverUrl = process.env.PUBLIC_URL || request.nextUrl.origin;
  const xrayEnabled = node.xrayEnabled;

  const script = `#!/bin/bash
#
# WireMesh Agent Install Script
# Node: ${node.name} (ID: ${node.id})
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

info()  { echo -e "\${BLUE}[INFO]\${NC}  $1"; }
ok()    { echo -e "\${GREEN}[OK]\${NC}    $1"; }
warn()  { echo -e "\${YELLOW}[WARN]\${NC}  $1"; }
fail()  { echo -e "\${RED}[FAIL]\${NC}  $1"; exit 1; }

echo ""
echo "======================================"
echo "  WireMesh Agent Installer"
echo "  Node: ${node.name} (ID: ${node.id})"
echo "======================================"
echo ""

# ============================================================
# Phase 1: Environment checks
# ============================================================
info "Phase 1: Checking environment..."

# 1.1 Root check
if [ "$(id -u)" -ne 0 ]; then
  fail "This script must be run as root"
fi
ok "Running as root"

# 1.2 Architecture check
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  AGENT_ARCH="amd64" ;;
  aarch64) AGENT_ARCH="arm64" ;;
  arm64)   AGENT_ARCH="arm64" ;;
  *) fail "Unsupported architecture: $ARCH (requires x86_64 or aarch64)" ;;
esac
ok "Architecture: $ARCH ($AGENT_ARCH)"

# 1.3 OS detection
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_VERSION_ID="$VERSION_ID"
  OS_NAME="$PRETTY_NAME"
else
  fail "Cannot detect OS: /etc/os-release not found"
fi

case "$OS_ID" in
  ubuntu)
    OS_MAJOR=$(echo "$OS_VERSION_ID" | cut -d. -f1)
    if [ "$OS_MAJOR" -lt 20 ]; then
      fail "Ubuntu $OS_VERSION_ID is not supported (requires 20.04+)"
    fi
    PKG_MANAGER="apt"
    ;;
  debian)
    OS_MAJOR=$(echo "$OS_VERSION_ID" | cut -d. -f1)
    if [ "$OS_MAJOR" -lt 11 ]; then
      fail "Debian $OS_VERSION_ID is not supported (requires 11+)"
    fi
    PKG_MANAGER="apt"
    ;;
  centos|rhel|rocky|almalinux)
    OS_MAJOR=$(echo "$OS_VERSION_ID" | cut -d. -f1)
    if [ "$OS_MAJOR" -lt 8 ]; then
      fail "$OS_ID $OS_VERSION_ID is not supported (requires 8+)"
    fi
    PKG_MANAGER="yum"
    ;;
  fedora)
    PKG_MANAGER="dnf"
    ;;
  *)
    fail "Unsupported OS: $OS_ID. Supported: Ubuntu 20+, Debian 11+, CentOS/RHEL/Rocky/Alma 8+, Fedora"
    ;;
esac
ok "OS: $OS_NAME ($PKG_MANAGER)"

# 1.4 Kernel version check (WireGuard built-in since 5.6)
KERNEL_VERSION=$(uname -r | cut -d- -f1)
KERNEL_MAJOR=$(echo "$KERNEL_VERSION" | cut -d. -f1)
KERNEL_MINOR=$(echo "$KERNEL_VERSION" | cut -d. -f2)
if [ "$KERNEL_MAJOR" -lt 5 ] || { [ "$KERNEL_MAJOR" -eq 5 ] && [ "$KERNEL_MINOR" -lt 6 ]; }; then
  warn "Kernel $KERNEL_VERSION is older than 5.6 (WireGuard may require DKMS module)"
else
  ok "Kernel: $(uname -r) (WireGuard built-in)"
fi

# 1.5 systemd check
if ! command -v systemctl &>/dev/null; then
  fail "systemd is required but not found"
fi
ok "systemd available"

# 1.6 curl check (install if missing)
if ! command -v curl &>/dev/null; then
  info "Installing curl..."
  if [ "$PKG_MANAGER" = "apt" ]; then
    apt-get update -qq && apt-get install -y -qq curl
  elif [ "$PKG_MANAGER" = "yum" ]; then
    yum install -y -q curl
  elif [ "$PKG_MANAGER" = "dnf" ]; then
    dnf install -y -q curl
  fi
fi
ok "curl available"

# 1.7 Network connectivity to management platform
if ! curl -fsSL --max-time 10 -o /dev/null "${serverUrl}/api/setup/status" 2>/dev/null; then
  fail "Cannot reach management platform at ${serverUrl}"
fi
ok "Management platform reachable"

# 1.8 Port check
WG_PORT=${node.port}
if ss -ulnp | grep -q ":$WG_PORT "; then
  EXISTING=$(ss -ulnp | grep ":$WG_PORT " | head -1)
  warn "UDP port $WG_PORT is already in use: $EXISTING"
  warn "Continuing anyway (may be a previous WireMesh installation)"
else
  ok "UDP port $WG_PORT is available"
fi

# 1.9 Disk space check (need at least 100MB)
AVAIL_KB=$(df /usr/local/bin --output=avail 2>/dev/null | tail -1 | tr -d ' ')
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt 102400 ]; then
  fail "Insufficient disk space: $(($AVAIL_KB/1024))MB available, need at least 100MB"
fi
ok "Disk space sufficient"

# 1.10 Check for existing installation
UPGRADE=false
if systemctl is-active wiremesh-agent &>/dev/null; then
  warn "WireMesh Agent is already running, will upgrade"
  UPGRADE=true
fi

echo ""

# ============================================================
# Phase 2: Install dependencies
# ============================================================
info "Phase 2: Installing dependencies..."

# Suppress interactive prompts (Ubuntu needrestart, etc.)
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# 2.1 Install WireGuard
if command -v wg &>/dev/null; then
  ok "WireGuard already installed"
else
  info "Installing WireGuard..."
  if [ "$PKG_MANAGER" = "apt" ]; then
    apt-get update -qq
    apt-get install -y -qq wireguard wireguard-tools
  elif [ "$PKG_MANAGER" = "yum" ]; then
    yum install -y -q epel-release
    yum install -y -q wireguard-tools
  elif [ "$PKG_MANAGER" = "dnf" ]; then
    dnf install -y -q wireguard-tools
  fi

  if ! command -v wg &>/dev/null; then
    fail "WireGuard installation failed"
  fi
  ok "WireGuard installed"
fi

# 2.2 Install iptables (some systems only have nftables)
if command -v iptables &>/dev/null; then
  ok "iptables already available"
else
  info "Installing iptables..."
  if [ "$PKG_MANAGER" = "apt" ]; then
    apt-get install -y -qq iptables
  elif [ "$PKG_MANAGER" = "yum" ]; then
    yum install -y -q iptables
  elif [ "$PKG_MANAGER" = "dnf" ]; then
    dnf install -y -q iptables
  fi

  if ! command -v iptables &>/dev/null; then
    fail "iptables installation failed"
  fi
  ok "iptables installed"
fi

echo ""

# ============================================================
# Phase 3: Configure WireGuard
# ============================================================
info "Phase 3: Configuring WireGuard..."

# 3.1 Create config directory
mkdir -p /etc/wiremesh/wireguard

# 3.2 Write WireGuard config
cat > /etc/wiremesh/wireguard/wm-wg0.conf << 'WGEOF'
[Interface]
PrivateKey = ${wgPrivateKey}
ListenPort = ${node.port}
WGEOF
chmod 600 /etc/wiremesh/wireguard/wm-wg0.conf
ok "WireGuard config written"

# 3.3 Enable IP forwarding
if sysctl net.ipv4.ip_forward | grep -q "= 1"; then
  ok "IP forwarding already enabled"
else
  info "Enabling IP forwarding..."
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-wiremesh.conf
  ok "IP forwarding enabled"
fi

# 3.4 Start WireGuard interface
if ip link show wm-wg0 &>/dev/null; then
  info "WireGuard interface wm-wg0 already exists, reconfiguring..."
  wg setconf wm-wg0 /etc/wiremesh/wireguard/wm-wg0.conf
else
  ip link add dev wm-wg0 type wireguard
  wg setconf wm-wg0 /etc/wiremesh/wireguard/wm-wg0.conf
  ip addr add ${node.wgAddress} dev wm-wg0 2>/dev/null || true
  ip link set up dev wm-wg0
fi
ok "WireGuard interface wm-wg0 is up"
${xrayEnabled ? `
# 3.5 Install Xray
if command -v xray &>/dev/null; then
  ok "Xray already installed"
else
  info "Installing Xray..."
  bash <(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh) install >/dev/null 2>&1
  ok "Xray installed"
fi
` : ""}
echo ""

# ============================================================
# Phase 4: Deploy Agent
# ============================================================
info "Phase 4: Deploying WireMesh Agent..."

# 4.1 Stop existing agent if upgrading
if [ "$UPGRADE" = true ]; then
  info "Stopping existing agent..."
  systemctl stop wiremesh-agent 2>/dev/null || true
  ok "Existing agent stopped"
fi

# 4.2 Download agent binary
info "Downloading agent binary ($AGENT_ARCH)..."
curl -fsSL "${serverUrl}/api/agent/binary?arch=$AGENT_ARCH" -o /usr/local/bin/wiremesh-agent
chmod +x /usr/local/bin/wiremesh-agent
ok "Agent binary downloaded"

# 4.3 Write agent config
cat > /etc/wiremesh/agent.yaml << 'AGENTEOF'
server_url: ${serverUrl}
node_id: ${node.id}
token: ${node.agentToken}
report_interval: 30
AGENTEOF
chmod 600 /etc/wiremesh/agent.yaml
ok "Agent config written"

# 4.4 Create systemd service
cat > /etc/systemd/system/wiremesh-agent.service << 'SVCEOF'
[Unit]
Description=WireMesh Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/wiremesh-agent --config /etc/wiremesh/agent.yaml
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
SVCEOF

# 4.5 Start agent
systemctl daemon-reload
systemctl enable wiremesh-agent >/dev/null 2>&1
systemctl start wiremesh-agent
ok "Agent service started"

echo ""

# ============================================================
# Summary
# ============================================================
echo "======================================"
echo -e "  \${GREEN}Installation complete!\${NC}"
echo "======================================"
echo ""
echo "  Node:      ${node.name} (ID: ${node.id})"
echo "  WG Port:   ${node.port}/udp"
echo "  WG Addr:   ${node.wgAddress}"
echo "  Agent:     $(systemctl is-active wiremesh-agent)"
echo ""
echo "  View logs: journalctl -u wiremesh-agent -f"
echo ""
`;

  return new NextResponse(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
