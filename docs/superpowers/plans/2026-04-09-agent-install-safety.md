# Agent Install Safety Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 safety issues: FORWARD chain warning, Xray service isolation, and uninstall script.

**Architecture:** All changes are in the install script template (TypeScript), Agent Xray manager (Go), a new uninstall script endpoint (TypeScript), and CLAUDE.md naming conventions. No database or API schema changes.

**Tech Stack:** TypeScript (Next.js API routes), Go, Bash (generated scripts)

**Spec:** `docs/superpowers/specs/2026-04-09-agent-install-safety-design.md`

---

### Task 1: Rename Xray service and binary in Agent Go code

**Files:**
- Modify: `agent/xray/manager.go:15,67`

- [ ] **Step 1: Change XrayService constant**

In `agent/xray/manager.go`, change line 15:

```go
// Before
XrayService    = "xray"

// After
XrayService    = "wiremesh-xray"
```

- [ ] **Step 2: Change LookPath to wiremesh-xray**

In `agent/xray/manager.go`, change line 67:

```go
// Before
_, err := exec.LookPath("xray")

// After
_, err := exec.LookPath("wiremesh-xray")
```

- [ ] **Step 3: Verify Go code compiles**

Run: `cd agent && go build ./...`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add agent/xray/manager.go
git commit -m "fix: rename Xray service to wiremesh-xray to avoid conflicts with existing Xray installations"
```

---

### Task 2: Update install script — Xray isolation + FORWARD warning

**Files:**
- Modify: `src/app/api/nodes/[id]/script/route.ts:286-358`

- [ ] **Step 1: Add FORWARD chain warning after ip_forward section**

In `src/app/api/nodes/[id]/script/route.ts`, after the ip_forward block (after the `fi` on line 293), add:

```bash
# 3.3b Check FORWARD chain default policy
FORWARD_POLICY=$(iptables -L FORWARD 2>/dev/null | head -1 | grep -oP '\\(policy \\K\\w+' || echo "unknown")
if [ "$FORWARD_POLICY" = "ACCEPT" ]; then
  warn "============================================"
  warn "FORWARD chain default policy is ACCEPT."
  warn "With ip_forward enabled, this server may"
  warn "forward traffic between network interfaces."
  warn "If this is not intended, consider running:"
  warn "  iptables -P FORWARD DROP"
  warn "============================================"
fi
```

- [ ] **Step 2: Update Xray binary install path**

Change the Xray download/install section. Replace the existing block (lines 308-325):

```bash
# 3.5 Install Xray (download from management platform)
if [ -f /usr/local/bin/wiremesh-xray ]; then
  ok "Xray already installed (wiremesh-xray)"
else
  info "Installing Xray..."
  curl -fsSL "${serverUrl}/api/agent/xray?arch=$AGENT_ARCH" -o /tmp/xray.tar.gz
  if [ -f /tmp/xray.tar.gz ] && [ -s /tmp/xray.tar.gz ]; then
    tar -xzf /tmp/xray.tar.gz -C /tmp/
    mv /tmp/xray /usr/local/bin/wiremesh-xray 2>/dev/null || \
      cp /tmp/xray /usr/local/bin/wiremesh-xray
    chmod +x /usr/local/bin/wiremesh-xray
    rm -f /tmp/xray.tar.gz /tmp/xray
    if [ -f /usr/local/bin/wiremesh-xray ]; then
      ok "Xray installed as wiremesh-xray"
    else
      warn "Xray installation failed (non-fatal, can be installed later)"
    fi
  else
    warn "Xray download failed (non-fatal, can be installed later)"
  fi
fi
```

- [ ] **Step 3: Replace Xray service section with independent wiremesh-xray.service**

Replace the entire Phase 3.6 Xray service block (lines 328-358) with:

```bash
# 3.6 Configure wiremesh-xray service
mkdir -p /etc/wiremesh/xray
cat > /etc/systemd/system/wiremesh-xray.service << 'XRAYSVCEOF'
[Unit]
Description=WireMesh Xray Service
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/wiremesh-xray run -config /etc/wiremesh/xray/config.json
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
XRAYSVCEOF
systemctl daemon-reload
systemctl enable wiremesh-xray >/dev/null 2>&1
# Do not start wiremesh-xray here — Agent will start it after pulling config
systemctl stop wiremesh-xray 2>/dev/null || true
ok "Xray service configured (wiremesh-xray)"
```

- [ ] **Step 4: Verify the TypeScript file has no syntax errors**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit src/app/api/nodes/\[id\]/script/route.ts 2>&1 || echo "Check manually"`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/nodes/[id]/script/route.ts
git commit -m "fix: add FORWARD chain warning and isolate Xray as wiremesh-xray service"
```

---

### Task 3: Add uninstall script API endpoint

**Files:**
- Create: `src/app/api/nodes/[id]/uninstall-script/route.ts`

- [ ] **Step 1: Create the uninstall script route**

Create `src/app/api/nodes/[id]/uninstall-script/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

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

  const token = request.nextUrl.searchParams.get("token");
  const hasSession = request.cookies.get("token")?.value;
  if (!hasSession && token !== node.agentToken) {
    return error("UNAUTHORIZED", "无权访问");
  }

  const script = `#!/bin/bash
#
# WireMesh Agent Uninstall Script
# Node: ${node.name} (ID: ${node.id})
# Generated: ${new Date().toISOString()}
#

set -e

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m'

info()  { echo -e "\${BLUE}[INFO]\${NC}  $1"; }
ok()    { echo -e "\${GREEN}[OK]\${NC}    $1"; }
warn()  { echo -e "\${YELLOW}[WARN]\${NC}  $1"; }
fail()  { echo -e "\${RED}[FAIL]\${NC}  $1"; exit 1; }

echo ""
echo "======================================"
echo "  WireMesh Agent Uninstaller"
echo "  Node: ${node.name} (ID: ${node.id})"
echo "======================================"
echo ""

if [ "$(id -u)" -ne 0 ]; then
  fail "This script must be run as root"
fi

# ============================================================
# Step 1: Stop and disable services
# ============================================================
info "Step 1: Stopping services..."

if systemctl is-active wiremesh-agent &>/dev/null; then
  systemctl stop wiremesh-agent
  ok "wiremesh-agent stopped"
else
  ok "wiremesh-agent not running"
fi
systemctl disable wiremesh-agent 2>/dev/null || true

if systemctl is-active wiremesh-xray &>/dev/null; then
  systemctl stop wiremesh-xray
  ok "wiremesh-xray stopped"
else
  ok "wiremesh-xray not running"
fi
systemctl disable wiremesh-xray 2>/dev/null || true

echo ""

# ============================================================
# Step 2: Remove WireGuard interfaces
# ============================================================
info "Step 2: Removing WireGuard interfaces..."

# Remove tunnel interfaces
for iface in $(ip -o link show 2>/dev/null | grep -oP 'wm-tun\\d+' || true); do
  ip link set down "\$iface" 2>/dev/null || true
  ip link del "\$iface" 2>/dev/null || true
  ok "Removed \$iface"
done

# Remove main interface
if ip link show wm-wg0 &>/dev/null; then
  ip link set down wm-wg0
  ip link del wm-wg0
  ok "Removed wm-wg0"
else
  ok "wm-wg0 not found"
fi

echo ""

# ============================================================
# Step 3: Clean iptables rules
# ============================================================
info "Step 3: Cleaning iptables rules..."

REMOVED=0

# filter FORWARD
while iptables -t filter -S FORWARD 2>/dev/null | grep -q "wm-"; do
  RULE=$(iptables -t filter -S FORWARD | grep "wm-" | head -1)
  DELETE_RULE=$(echo "\$RULE" | sed 's/^-A /-D /')
  iptables -t filter \$DELETE_RULE 2>/dev/null && REMOVED=$((REMOVED+1))
done

# nat POSTROUTING
while iptables -t nat -S POSTROUTING 2>/dev/null | grep -q "wm-"; do
  RULE=$(iptables -t nat -S POSTROUTING | grep "wm-" | head -1)
  DELETE_RULE=$(echo "\$RULE" | sed 's/^-A /-D /')
  iptables -t nat \$DELETE_RULE 2>/dev/null && REMOVED=$((REMOVED+1))
done

# mangle PREROUTING
while iptables -t mangle -S PREROUTING 2>/dev/null | grep -q "wm-"; do
  RULE=$(iptables -t mangle -S PREROUTING | grep "wm-" | head -1)
  DELETE_RULE=$(echo "\$RULE" | sed 's/^-A /-D /')
  iptables -t mangle \$DELETE_RULE 2>/dev/null && REMOVED=$((REMOVED+1))
done

# mangle OUTPUT
while iptables -t mangle -S OUTPUT 2>/dev/null | grep -q "wm-"; do
  RULE=$(iptables -t mangle -S OUTPUT | grep "wm-" | head -1)
  DELETE_RULE=$(echo "\$RULE" | sed 's/^-A /-D /')
  iptables -t mangle \$DELETE_RULE 2>/dev/null && REMOVED=$((REMOVED+1))
done

ok "Removed \$REMOVED iptables rules"

echo ""

# ============================================================
# Step 4: Clean ip rules and routing tables
# ============================================================
info "Step 4: Cleaning routing tables..."

# Device routes (101-199)
for i in $(seq 101 199); do
  ip rule del lookup "\$i" priority "\$i" 2>/dev/null || true
  ip route flush table "\$i" 2>/dev/null || true
done

# Relay routes (201-299)
for i in $(seq 201 299); do
  ip rule del lookup "\$i" priority "\$i" 2>/dev/null || true
  ip route flush table "\$i" 2>/dev/null || true
done

# Branch fwmark routes (41001-41100)
for i in $(seq 41001 41100); do
  HEX=$(printf "0x%x" "\$i")
  ip rule del fwmark "\$HEX" 2>/dev/null || true
  ip route flush table "\$i" 2>/dev/null || true
done
ip rule del priority 32000 2>/dev/null || true

# Xray fwmark routes (42001-42099)
for i in $(seq 42001 42099); do
  HEX=$(printf "0x%x" "\$i")
  ip rule del fwmark "\$HEX" 2>/dev/null || true
  ip route flush table "\$i" 2>/dev/null || true
done

ok "Routing tables cleaned"

echo ""

# ============================================================
# Step 5: Clean ipset
# ============================================================
info "Step 5: Cleaning ipsets..."

IPSET_REMOVED=0
for name in $(ipset list -n 2>/dev/null | grep "^wm-" || true); do
  ipset destroy "\$name" 2>/dev/null && IPSET_REMOVED=$((IPSET_REMOVED+1))
done
ok "Removed \$IPSET_REMOVED ipsets"

echo ""

# ============================================================
# Step 6: Restore sysctl
# ============================================================
info "Step 6: Restoring sysctl..."

if [ -f /etc/sysctl.d/99-wiremesh.conf ]; then
  rm -f /etc/sysctl.d/99-wiremesh.conf
  # Check if other services need ip_forward (e.g. Docker)
  if systemctl is-active docker &>/dev/null || systemctl is-active containerd &>/dev/null; then
    warn "Docker detected — keeping ip_forward=1"
  else
    sysctl -w net.ipv4.ip_forward=0 >/dev/null
    ok "ip_forward disabled"
  fi
  ok "Removed /etc/sysctl.d/99-wiremesh.conf"
else
  ok "No sysctl config to remove"
fi

echo ""

# ============================================================
# Step 7: Remove files
# ============================================================
info "Step 7: Removing files..."

rm -f /etc/systemd/system/wiremesh-agent.service
rm -f /etc/systemd/system/wiremesh-xray.service
rm -rf /etc/wiremesh/
rm -f /usr/local/bin/wiremesh-agent
rm -f /usr/local/bin/wiremesh-xray
systemctl daemon-reload
ok "All WireMesh files removed"

echo ""

# ============================================================
# Summary
# ============================================================
echo "======================================"
echo -e "  \${GREEN}Uninstall complete!\${NC}"
echo "======================================"
echo ""
echo "  Removed: services, interfaces, iptables rules,"
echo "           routing tables, ipsets, config files"
echo ""
echo "  NOT removed: wireguard, iptables, ipset packages"
echo "  (may be used by other software)"
echo ""
`;

  return new NextResponse(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/nodes/[id]/uninstall-script/route.ts
git commit -m "feat: add uninstall script API endpoint for complete server cleanup"
```

---

### Task 4: Update CLAUDE.md naming conventions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Xray naming entries to the naming table**

In the naming conventions table in `CLAUDE.md`, add two rows after the existing entries:

```markdown
| Xray 二进制 | wiremesh-xray |
| Xray 服务 | wiremesh-xray.service |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add wiremesh-xray naming conventions to CLAUDE.md"
```

---

### Task 5: Clean up legacy Xray references in install script

**Files:**
- Modify: `src/app/api/nodes/[id]/script/route.ts`

- [ ] **Step 1: Verify no remaining references to old xray.service**

Run: `grep -n 'xray\.service\|/usr/local/bin/xray[^-]' src/app/api/nodes/[id]/script/route.ts`
Expected: no matches (or only within comments describing the change)

- [ ] **Step 2: Verify no remaining override logic**

Run: `grep -n 'xray.service.d\|wiremesh.conf.*XRAY' src/app/api/nodes/[id]/script/route.ts`
Expected: no matches

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
# Only if Step 1 or 2 found issues
git add src/app/api/nodes/[id]/script/route.ts
git commit -m "fix: remove remaining legacy xray.service references"
```
