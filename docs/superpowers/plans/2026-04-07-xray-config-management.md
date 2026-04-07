# Xray Reality Config Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Xray devices work end-to-end: management platform auto-generates Reality keys, Agent writes Xray config and manages the service, clients connect via VLESS+Reality+Vision.

**Architecture:** Only support VLESS + Reality + Vision (no TLS mode). Reality keys are X25519 (same curve as WireGuard). Keys and config are stored in the existing `xrayConfig` JSON text field — no schema migration. Install script always installs Xray. Agent gets a new `xray/` package that generates the Xray JSON config and manages the systemd service.

**Tech Stack:** Go (agent), TypeScript/Next.js (API + frontend), Node.js `crypto` X25519 (key generation), Xray-core Reality JSON config format.

---

## Key Design Decisions

1. **Only Reality, no TLS** — simpler, no domain/cert needed, better security
2. **No schema migration** — Reality settings stored in existing `xrayConfig` JSON text field
3. **Transport hardcoded to TCP** — Reality + Vision uses TCP, remove ws/grpc selector
4. **Install script always installs Xray** — regardless of `xrayEnabled`, so it can be toggled later
5. **Reality keypair auto-generated** — like WireGuard keys, generated when Xray is first enabled
6. **Private key encrypted** — same AES-256-GCM as WireGuard private keys

### xrayConfig JSON format (stored in DB)

```json
{
  "realityPrivateKey": "AES_ENCRYPTED_BASE64",
  "realityPublicKey": "base64url_encoded",
  "realityShortId": "0123456789abcdef",
  "realityDest": "www.microsoft.com:443",
  "realityServerName": "www.microsoft.com"
}
```

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/reality.ts` | Create | Generate Reality X25519 keypair + shortId |
| `src/app/api/nodes/route.ts` | Modify | Auto-generate Reality keys on node creation |
| `src/app/api/nodes/[id]/route.ts` | Modify | Auto-generate Reality keys when enabling Xray on edit |
| `src/app/(dashboard)/nodes/[id]/page.tsx` | Modify | Reality dest input, show publicKey/shortId, remove transport selector |
| `src/app/api/agent/config/route.ts` | Modify | Return structured xray with Reality settings + UUIDs |
| `src/app/api/devices/[id]/config/route.ts` | Modify | Client config uses Reality instead of TLS |
| `agent/api/config_types.go` | Modify | Typed XrayConfig with Reality fields |
| `agent/xray/config.go` | Create | Generate Xray server JSON config (Reality inbound) |
| `agent/xray/manager.go` | Create | Write config file + manage systemd service |
| `agent/agent/agent.go` | Modify | Call xray.Sync in config apply pipeline |
| `src/app/api/nodes/[id]/script/route.ts` | Modify | Always install Xray + config dir + systemd override |

---

## Task 1: Reality Key Generation Utility

**Files:**
- Create: `src/lib/reality.ts`

Reality uses X25519 keys (same as WireGuard) but encoded as base64url (no padding). The existing `src/lib/wireguard.ts` already generates X25519 keys with standard base64 — we follow the same pattern but with base64url encoding.

- [ ] **Step 1: Create `src/lib/reality.ts`**

```ts
import { generateKeyPairSync, randomBytes } from "crypto";

export function generateRealityKeypair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("x25519", {});
  const privRaw = privateKey
    .export({ type: "pkcs8", format: "der" })
    .subarray(-32);
  const pubRaw = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  return {
    privateKey: Buffer.from(privRaw).toString("base64url"),
    publicKey: Buffer.from(pubRaw).toString("base64url"),
  };
}

export function generateShortId(): string {
  return randomBytes(8).toString("hex");
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -10`
Expected: Build succeeds (file exists but isn't imported yet, tree-shaking won't include it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/reality.ts
git commit -m "feat: add Reality X25519 keypair and shortId generation utility"
```

---

## Task 2: Auto-Generate Reality Keys in Node API

**Files:**
- Modify: `src/app/api/nodes/route.ts` (POST — node creation)
- Modify: `src/app/api/nodes/[id]/route.ts` (PUT — node edit)

When `xrayEnabled` is true and no Reality keys exist yet, auto-generate them and store in `xrayConfig` JSON field. The Reality private key is encrypted with AES-256-GCM (same as WG private keys).

- [ ] **Step 1: Update node creation API (POST)**

In `src/app/api/nodes/route.ts`, add imports at line 9 (after the wireguard import):

```ts
import { generateRealityKeypair, generateShortId } from "@/lib/reality";
```

After line 122 (`const agentToken = uuidv4();`), add Reality key generation:

```ts
  // Generate Reality keypair if Xray is enabled
  let resolvedXrayConfig = xrayConfig ?? null;
  if (xrayEnabled) {
    const realityKeys = generateRealityKeypair();
    const shortId = generateShortId();
    resolvedXrayConfig = JSON.stringify({
      realityPrivateKey: encrypt(realityKeys.privateKey),
      realityPublicKey: realityKeys.publicKey,
      realityShortId: shortId,
      realityDest: body.realityDest || "www.microsoft.com:443",
      realityServerName: body.realityServerName || "www.microsoft.com",
    });
  }
```

In the `db.insert(nodes).values({...})` block, change line 139:

```ts
      xrayConfig: resolvedXrayConfig,
```

Also change line 137 to hardcode "vless" protocol:

```ts
      xrayProtocol: xrayEnabled ? "vless" : null,
      xrayTransport: xrayEnabled ? "tcp" : null,
```

- [ ] **Step 2: Update node edit API (PUT)**

In `src/app/api/nodes/[id]/route.ts`, add imports after line 5:

```ts
import { encrypt } from "@/lib/crypto";
import { generateRealityKeypair, generateShortId } from "@/lib/reality";
```

After the `updateData` assignment block (after line 96), add Reality key auto-generation logic. This triggers when Xray is being enabled and no existing keys are present:

```ts
  // Auto-generate Reality keys when enabling Xray for the first time
  if (xrayEnabled === true) {
    const currentNode = db.select({ xrayConfig: nodes.xrayConfig, xrayEnabled: nodes.xrayEnabled }).from(nodes).where(eq(nodes.id, nodeId)).get();
    let needKeys = true;
    if (currentNode?.xrayConfig) {
      try {
        const parsed = JSON.parse(currentNode.xrayConfig);
        if (parsed.realityPublicKey) needKeys = false;
      } catch {}
    }
    if (needKeys) {
      const realityKeys = generateRealityKeypair();
      const shortId = generateShortId();
      updateData.xrayConfig = JSON.stringify({
        realityPrivateKey: encrypt(realityKeys.privateKey),
        realityPublicKey: realityKeys.publicKey,
        realityShortId: shortId,
        realityDest: body.realityDest || "www.microsoft.com:443",
        realityServerName: body.realityServerName || "www.microsoft.com",
      });
    } else if (body.realityDest !== undefined || body.realityServerName !== undefined) {
      // Update dest/serverName without regenerating keys
      const parsed = JSON.parse(currentNode!.xrayConfig!);
      if (body.realityDest !== undefined) parsed.realityDest = body.realityDest;
      if (body.realityServerName !== undefined) parsed.realityServerName = body.realityServerName;
      updateData.xrayConfig = JSON.stringify(parsed);
    }
    updateData.xrayProtocol = "vless";
    updateData.xrayTransport = "tcp";
  }
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/nodes/route.ts src/app/api/nodes/\[id\]/route.ts
git commit -m "feat: auto-generate Reality keypair when enabling Xray on nodes"
```

---

## Task 3: Update Node Edit Form for Reality

**Files:**
- Modify: `src/app/(dashboard)/nodes/[id]/page.tsx`

Replace the transport selector (ws/grpc) with a Reality target website input. Show the auto-generated publicKey and shortId as read-only fields.

- [ ] **Step 1: Update state and form fields**

In `src/app/(dashboard)/nodes/[id]/page.tsx`:

Replace the `xrayTransport` state (line 79) and `xrayPort` state (line 80):

```tsx
const [xrayPort, setXrayPort] = useState("");
const [realityDest, setRealityDest] = useState("");
const [realityPublicKey, setRealityPublicKey] = useState("");
const [realityShortId, setRealityShortId] = useState("");
```

Remove the `xrayTransport` state line entirely.

In the `useEffect` where node data is loaded (around line 100-101), replace:

```tsx
        setXrayTransport(n.xrayTransport ?? "");
        setXrayPort(n.xrayPort ? String(n.xrayPort) : "");
```

with:

```tsx
        setXrayPort(n.xrayPort ? String(n.xrayPort) : "");
        if (n.xrayConfig) {
          try {
            const cfg = JSON.parse(n.xrayConfig);
            setRealityDest(cfg.realityDest ?? "");
            setRealityPublicKey(cfg.realityPublicKey ?? "");
            setRealityShortId(cfg.realityShortId ?? "");
          } catch {}
        }
```

In the `handleSave` function, update the body object. Replace:

```tsx
        xrayTransport: xrayEnabled ? xrayTransport || null : null,
```

with:

```tsx
        realityDest: xrayEnabled ? realityDest || "www.microsoft.com:443" : undefined,
        realityServerName: xrayEnabled
          ? (realityDest || "www.microsoft.com:443").replace(/:\d+$/, "")
          : undefined,
```

- [ ] **Step 2: Update the Xray form section in JSX**

Replace the entire `{xrayEnabled && (...)}` block (lines 253-280) with:

```tsx
{xrayEnabled && (
  <>
    <div className="space-y-1">
      <Label htmlFor="xrayPort">Xray 端口</Label>
      <Input
        id="xrayPort"
        type="number"
        value={xrayPort}
        onChange={(e) => setXrayPort(e.target.value)}
        placeholder="443"
      />
    </div>
    <div className="space-y-1">
      <Label htmlFor="realityDest">Reality 目标网站</Label>
      <Input
        id="realityDest"
        value={realityDest}
        onChange={(e) => setRealityDest(e.target.value)}
        placeholder="www.microsoft.com:443"
      />
      <p className="text-xs text-muted-foreground">
        伪装目标，需支持 TLS 1.3，如 www.microsoft.com:443
      </p>
    </div>
    {realityPublicKey && (
      <>
        <div className="space-y-1">
          <Label>Reality Public Key</Label>
          <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
            {realityPublicKey}
          </code>
        </div>
        <div className="space-y-1">
          <Label>Reality Short ID</Label>
          <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
            {realityShortId}
          </code>
        </div>
      </>
    )}
  </>
)}
```

Also remove the `Select` imports at the top of the file if they're only used for xrayTransport — check lines 18-23. If `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` are not used elsewhere in the file, remove their import.

- [ ] **Step 3: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/nodes/\[id\]/page.tsx
git commit -m "feat: update node edit form with Reality dest and read-only keys"
```

---

## Task 4: Config API Returns Structured Xray with Reality Settings

**Files:**
- Modify: `src/app/api/agent/config/route.ts`

The config API currently returns the raw `xrayConfig` blob. Change it to return a structured object the Agent can consume, including Reality settings and device UUIDs.

- [ ] **Step 1: Replace the xray config section**

In `src/app/api/agent/config/route.ts`, add `devices` to the schema import (line 3):

```ts
import { nodes, lineNodes, lineTunnels, devices } from "@/lib/db/schema";
```

Add the decrypt import (line 5, after the existing decrypt import — it's already there):

```ts
import { decrypt } from "@/lib/crypto";
```

Replace lines 187-195 (the `// ---- Xray config ----` section) with:

```ts
  // ---- Xray config ----
  let xrayConfig: {
    enabled: boolean;
    protocol: string;
    port: number;
    uuids: string[];
    realityPrivateKey: string;
    realityShortId: string;
    realityDest: string;
    realityServerNames: string[];
  } | null = null;

  if (node.xrayEnabled && node.xrayConfig) {
    let realitySettings: {
      realityPrivateKey?: string;
      realityPublicKey?: string;
      realityShortId?: string;
      realityDest?: string;
      realityServerName?: string;
    } = {};
    try {
      realitySettings = JSON.parse(node.xrayConfig);
    } catch {}

    // Decrypt Reality private key
    let realityPrivateKey = "";
    if (realitySettings.realityPrivateKey) {
      try {
        realityPrivateKey = decrypt(realitySettings.realityPrivateKey);
      } catch {
        realityPrivateKey = "";
      }
    }

    // Collect Xray device UUIDs from lines where this node is entry
    const xrayUuids: string[] = [];
    for (const lineId of entryLineIds) {
      const xrayDevices = db
        .select({ xrayUuid: devices.xrayUuid })
        .from(devices)
        .where(eq(devices.lineId, lineId))
        .all()
        .filter((d) => d.xrayUuid);
      for (const d of xrayDevices) {
        if (d.xrayUuid && !xrayUuids.includes(d.xrayUuid)) {
          xrayUuids.push(d.xrayUuid);
        }
      }
    }

    xrayConfig = {
      enabled: true,
      protocol: "vless",
      port: node.xrayPort ?? 443,
      uuids: xrayUuids,
      realityPrivateKey,
      realityShortId: realitySettings.realityShortId ?? "",
      realityDest: realitySettings.realityDest ?? "www.microsoft.com:443",
      realityServerNames: [realitySettings.realityServerName ?? "www.microsoft.com"],
    };
  }
```

The `xray: xrayConfig` in the response object stays the same.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat: return structured xray Reality config with device UUIDs in agent config API"
```

---

## Task 5: Update Client Config to Use Reality

**Files:**
- Modify: `src/app/api/devices/[id]/config/route.ts`

Change the Xray client config from TLS to Reality. The client needs: `security: "reality"`, publicKey, shortId, serverName, fingerprint.

- [ ] **Step 1: Replace the Xray client config generation**

In `src/app/api/devices/[id]/config/route.ts`, replace lines 77-131 (the entire `if (protocol === "xray")` block) with:

```ts
  if (protocol === "xray") {
    if (!device.xrayUuid) {
      return error("VALIDATION_ERROR", "设备 Xray UUID 不完整");
    }

    if (!entryNodeRow.nodeXrayEnabled) {
      return error("VALIDATION_ERROR", "入口节点未启用 Xray");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const xrayPort = entryNodeRow.nodeXrayPort ?? 443;

    // Parse Reality settings from node's xrayConfig
    let realityPublicKey = "";
    let realityShortId = "";
    let realityServerName = "www.microsoft.com";

    const nodeXrayConfig = db
      .select({ xrayConfig: nodes.xrayConfig })
      .from(nodes)
      .where(eq(nodes.id, entryNodeRow.nodeId))
      .get();
    if (nodeXrayConfig?.xrayConfig) {
      try {
        const parsed = JSON.parse(nodeXrayConfig.xrayConfig);
        realityPublicKey = parsed.realityPublicKey ?? "";
        realityShortId = parsed.realityShortId ?? "";
        realityServerName = parsed.realityServerName ?? "www.microsoft.com";
      } catch {}
    }

    if (!realityPublicKey) {
      return error("VALIDATION_ERROR", "入口节点 Reality 配置不完整");
    }

    const xrayConfig = {
      log: { loglevel: "warning" },
      inbounds: [
        {
          port: 1080,
          protocol: "socks",
          settings: { auth: "noauth" },
        },
      ],
      outbounds: [
        {
          tag: "proxy",
          protocol: "vless",
          settings: {
            vnext: [
              {
                address: endpoint,
                port: xrayPort,
                users: [
                  {
                    id: device.xrayUuid,
                    encryption: "none",
                    flow: "xtls-rprx-vision",
                  },
                ],
              },
            ],
          },
          streamSettings: {
            network: "tcp",
            security: "reality",
            realitySettings: {
              serverName: realityServerName,
              fingerprint: "chrome",
              publicKey: realityPublicKey,
              shortId: realityShortId,
            },
          },
        },
        {
          tag: "direct",
          protocol: "freedom",
        },
      ],
    };

    const config = JSON.stringify(xrayConfig, null, 2);
    const filename = `${device.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-xray.json`;
    return success({ format: "xray", config, filename });
  }
```

Add the `nodes` import if not already present — check the imports at line 3. Currently:

```ts
import { devices, lineNodes, nodes, settings } from "@/lib/db/schema";
```

`nodes` is already imported. Good.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/devices/\[id\]/config/route.ts
git commit -m "feat: generate Xray client config with VLESS Reality instead of TLS"
```

---

## Task 6: Add Typed XrayConfig to Agent

**Files:**
- Modify: `agent/api/config_types.go`

- [ ] **Step 1: Replace `Xray interface{}` with typed struct**

In `agent/api/config_types.go`, replace line 12:

```go
	Xray    interface{}  `json:"xray"`
```

with:

```go
	Xray    *XrayConfig  `json:"xray"`
```

Add the `XrayConfig` struct at the end of the file (after `TunnelInterface`):

```go
type XrayConfig struct {
	Enabled            bool     `json:"enabled"`
	Protocol           string   `json:"protocol"`
	Port               int      `json:"port"`
	UUIDs              []string `json:"uuids"`
	RealityPrivateKey  string   `json:"realityPrivateKey"`
	RealityShortId     string   `json:"realityShortId"`
	RealityDest        string   `json:"realityDest"`
	RealityServerNames []string `json:"realityServerNames"`
}
```

- [ ] **Step 2: Verify Go builds**

Run: `cd /home/coder/workspaces/wiremesh/agent && go build ./...`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add agent/api/config_types.go
git commit -m "feat: add typed XrayConfig struct with Reality fields to agent API types"
```

---

## Task 7: Create Agent Xray Package

**Files:**
- Create: `agent/xray/config.go`
- Create: `agent/xray/manager.go`

### Part A: Config generator

Generates the Xray server-side JSON config with Reality inbound.

- [ ] **Step 1: Create `agent/xray/config.go`**

```go
package xray

import (
	"encoding/json"

	"github.com/wiremesh/agent/api"
)

type xrayFullConfig struct {
	Log       xrayLog        `json:"log"`
	Inbounds  []xrayInbound  `json:"inbounds"`
	Outbounds []xrayOutbound `json:"outbounds"`
}

type xrayLog struct {
	Loglevel string `json:"loglevel"`
}

type xrayInbound struct {
	Listen         string                 `json:"listen"`
	Port           int                    `json:"port"`
	Protocol       string                 `json:"protocol"`
	Settings       map[string]interface{} `json:"settings"`
	StreamSettings map[string]interface{} `json:"streamSettings"`
}

type xrayOutbound struct {
	Protocol string `json:"protocol"`
	Tag      string `json:"tag"`
}

// GenerateConfig produces the Xray server JSON config for Reality mode.
func GenerateConfig(cfg *api.XrayConfig) ([]byte, error) {
	clients := make([]map[string]interface{}, len(cfg.UUIDs))
	for i, uuid := range cfg.UUIDs {
		clients[i] = map[string]interface{}{
			"id":   uuid,
			"flow": "xtls-rprx-vision",
		}
	}

	config := xrayFullConfig{
		Log: xrayLog{Loglevel: "warning"},
		Inbounds: []xrayInbound{
			{
				Listen:   "0.0.0.0",
				Port:     cfg.Port,
				Protocol: cfg.Protocol,
				Settings: map[string]interface{}{
					"clients":    clients,
					"decryption": "none",
				},
				StreamSettings: map[string]interface{}{
					"network":  "tcp",
					"security": "reality",
					"realitySettings": map[string]interface{}{
						"show":        false,
						"dest":        cfg.RealityDest,
						"xver":        0,
						"serverNames": cfg.RealityServerNames,
						"privateKey":  cfg.RealityPrivateKey,
						"shortIds":    []string{cfg.RealityShortId},
					},
				},
			},
		},
		Outbounds: []xrayOutbound{
			{Protocol: "freedom", Tag: "direct"},
		},
	}

	return json.MarshalIndent(config, "", "  ")
}
```

### Part B: Service manager

- [ ] **Step 2: Create `agent/xray/manager.go`**

```go
package xray

import (
	"fmt"
	"log"
	"os"
	"os/exec"

	"github.com/wiremesh/agent/api"
)

const (
	XrayConfigDir  = "/etc/wiremesh/xray"
	XrayConfigFile = "/etc/wiremesh/xray/config.json"
	XrayService    = "xray"
)

// Sync generates the Xray config and manages the service.
// If cfg is nil or not enabled, it stops the service.
func Sync(cfg *api.XrayConfig) error {
	if cfg == nil || !cfg.Enabled {
		return stopIfRunning()
	}

	configBytes, err := GenerateConfig(cfg)
	if err != nil {
		return fmt.Errorf("generate xray config: %w", err)
	}

	if err := os.MkdirAll(XrayConfigDir, 0700); err != nil {
		return fmt.Errorf("create xray config dir: %w", err)
	}

	// Check if config changed
	existing, _ := os.ReadFile(XrayConfigFile)
	if string(existing) == string(configBytes) {
		log.Println("[xray] Config unchanged, skipping")
		return ensureRunning()
	}

	if err := os.WriteFile(XrayConfigFile, configBytes, 0600); err != nil {
		return fmt.Errorf("write xray config: %w", err)
	}
	log.Printf("[xray] Config written to %s (%d clients)", XrayConfigFile, len(cfg.UUIDs))

	if isRunning() {
		return restart()
	}
	return start()
}

// Stop stops the Xray service. Called during agent shutdown.
func Stop() {
	if isRunning() {
		log.Println("[xray] Stopping service")
		_ = systemctl("stop", XrayService)
	}
}

func isInstalled() bool {
	_, err := exec.LookPath("xray")
	return err == nil
}

func isRunning() bool {
	return exec.Command("systemctl", "is-active", "--quiet", XrayService).Run() == nil
}

func start() error {
	if !isInstalled() {
		return fmt.Errorf("xray binary not found in PATH; install Xray first")
	}
	log.Println("[xray] Starting service")
	return systemctl("start", XrayService)
}

func restart() error {
	log.Println("[xray] Restarting service")
	return systemctl("restart", XrayService)
}

func stopIfRunning() error {
	if isRunning() {
		log.Println("[xray] Disabling: stopping service")
		return systemctl("stop", XrayService)
	}
	return nil
}

func ensureRunning() error {
	if !isRunning() {
		return start()
	}
	return nil
}

func systemctl(action, service string) error {
	cmd := exec.Command("systemctl", action, service)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s %s: %w: %s", action, service, err, string(output))
	}
	return nil
}
```

- [ ] **Step 3: Verify Go builds**

Run: `cd /home/coder/workspaces/wiremesh/agent && go build ./...`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add agent/xray/config.go agent/xray/manager.go
git commit -m "feat: add Xray Reality config generator and service manager"
```

---

## Task 8: Integrate Xray Sync into Agent Pipeline

**Files:**
- Modify: `agent/agent/agent.go`

- [ ] **Step 1: Add xray import and sync call**

In `agent/agent/agent.go`, add imports. Current imports (lines 3-13):

```go
import (
	"context"
	"log"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/collector"
	"github.com/wiremesh/agent/config"
	"github.com/wiremesh/agent/iptables"
	"github.com/wiremesh/agent/wg"
)
```

Add `"fmt"` and the xray import:

```go
import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/collector"
	"github.com/wiremesh/agent/config"
	"github.com/wiremesh/agent/iptables"
	"github.com/wiremesh/agent/wg"
	"github.com/wiremesh/agent/xray"
)
```

In `pullAndApplyConfigForce`, after the routing sync block (after line 133), add:

```go
	// 5. Sync Xray config
	if err := xray.Sync(cfgData.Xray); err != nil {
		log.Printf("[agent] xray sync error: %v", err)
	}
```

Replace the log line at line 136-137:

```go
	a.lastVersion = cfgData.Version
	log.Printf("[agent] Config applied. Tunnels: %d, iptables rules: %d",
		len(a.activeTunnels), len(cfgData.Tunnels.IptablesRules))
```

with:

```go
	a.lastVersion = cfgData.Version
	xrayStatus := "disabled"
	if cfgData.Xray != nil && cfgData.Xray.Enabled {
		xrayStatus = fmt.Sprintf("enabled (%d clients)", len(cfgData.Xray.UUIDs))
	}
	log.Printf("[agent] Config applied. Tunnels: %d, iptables: %d, xray: %s",
		len(a.activeTunnels), len(cfgData.Tunnels.IptablesRules), xrayStatus)
```

In `shutdown()`, add `xray.Stop()` before the tunnel cleanup loop (before line 156):

```go
func (a *Agent) shutdown() {
	log.Println("[agent] Shutting down...")
	if a.sse != nil {
		a.sse.Stop()
	}
	xray.Stop()
	for name := range a.activeTunnels {
```

- [ ] **Step 2: Verify Go builds**

Run: `cd /home/coder/workspaces/wiremesh/agent && go build ./...`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add agent/agent/agent.go
git commit -m "feat: integrate Xray Reality sync into agent config pipeline"
```

---

## Task 9: Install Script Always Installs Xray + Systemd Override

**Files:**
- Modify: `src/app/api/nodes/[id]/script/route.ts`

Two changes: (1) always install Xray regardless of `xrayEnabled`, (2) add config directory and systemd service override to use our config path.

- [ ] **Step 1: Replace the conditional Xray install section**

In `src/app/api/nodes/[id]/script/route.ts`, replace lines 282-291 (the `${xrayEnabled ? ...}` block) with a non-conditional block:

```ts
# 3.5 Install Xray
if command -v xray &>/dev/null; then
  ok "Xray already installed"
else
  info "Installing Xray..."
  bash <(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh) install >/dev/null 2>&1
  if ! command -v xray &>/dev/null; then
    warn "Xray installation failed (non-fatal, can be installed later)"
  else
    ok "Xray installed"
  fi
fi

# 3.6 Configure Xray service for WireMesh
mkdir -p /etc/wiremesh/xray
mkdir -p /etc/systemd/system/xray.service.d
cat > /etc/systemd/system/xray.service.d/wiremesh.conf << 'XRAYEOF'
[Service]
ExecStart=
ExecStart=/usr/local/bin/xray run -config /etc/wiremesh/xray/config.json
XRAYEOF
systemctl daemon-reload
# Do not start xray here — Agent will start it after pulling config
systemctl stop xray 2>/dev/null || true
ok "Xray service configured"
```

Note: this replaces the `${xrayEnabled ? ... : ""}` template literal — the new code is always included, no conditional. Remove the `${` and `}` wrapping and the ternary.

Also, the variable `xrayEnabled` on line 38 can be removed since it's no longer used in the script template.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/nodes/\[id\]/script/route.ts
git commit -m "feat: install script always installs Xray with systemd override"
```

---

## Task 10: Build Agent Binaries

**Files:**
- Build output: `agent/wiremesh-agent-linux-amd64`, `agent/wiremesh-agent-linux-arm64`

- [ ] **Step 1: Cross-compile the agent binary**

```bash
cd /home/coder/workspaces/wiremesh/agent
GOOS=linux GOARCH=amd64 go build -o wiremesh-agent-linux-amd64 .
GOOS=linux GOARCH=arm64 go build -o wiremesh-agent-linux-arm64 .
```

- [ ] **Step 2: Verify binaries were created**

Run: `ls -la /home/coder/workspaces/wiremesh/agent/wiremesh-agent-linux-*`
Expected: Both binaries exist with recent timestamps.

- [ ] **Step 3: Commit**

```bash
git add agent/wiremesh-agent-linux-amd64 agent/wiremesh-agent-linux-arm64
git commit -m "build: recompile agent binaries with Xray Reality support"
```

---

## Summary

| Task | What | Language |
|------|------|---------|
| 1 | Reality X25519 keypair + shortId generation | TypeScript |
| 2 | Node API: auto-generate Reality keys on create/edit | TypeScript |
| 3 | Node edit form: Reality dest + show keys | React |
| 4 | Config API: structured xray with Reality settings + UUIDs | TypeScript |
| 5 | Client config: VLESS Reality instead of TLS | TypeScript |
| 6 | Agent XrayConfig types with Reality fields | Go |
| 7 | Agent xray package: config generator + service manager | Go |
| 8 | Agent pipeline: integrate xray.Sync | Go |
| 9 | Install script: always install Xray + systemd override | TypeScript |
| 10 | Recompile agent binaries | Go build |

## End-to-End Flow

```
1. 安装脚本始终安装 Xray 二进制 + 创建 /etc/wiremesh/xray/ + systemd override
2. 管理员编辑节点，启用 Xray → 自动生成 Reality X25519 密钥对 + shortId
3. 管理员设置 Reality 目标网站（如 www.microsoft.com:443）和端口
4. 创建 Xray 协议设备，自动生成 UUID
5. Agent 拉取 config → 收到 xray: { enabled, port, uuids, realityPrivateKey, realityDest, ... }
6. Agent xray.Sync() → 生成 Xray JSON → 写入 /etc/wiremesh/xray/config.json → systemctl start xray
7. 客户端下载配置（VLESS + Reality + Vision）→ 连接节点
8. 流量路径: 客户端 → VLESS Reality → Xray inbound → freedom outbound → wm-wg0 → WireGuard 隧道链 → 出口
9. 设备增删 → SSE config_update → Agent 重新拉取 → xray.Sync() 更新 UUID → restart xray
```
