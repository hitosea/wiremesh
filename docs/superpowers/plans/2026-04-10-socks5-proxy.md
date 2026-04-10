# SOCKS5 Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SOCKS5 as a third device protocol alongside WireGuard and Xray, with shared port allocation, username/password auth, and in-process Go SOCKS5 server in the Agent.

**Architecture:** SOCKS5 mirrors Xray's per-line port model. The platform generates credentials per device, allocates ports from a shared pool (Xray + SOCKS5), and delivers config to the Agent via the existing `/api/agent/config` endpoint. The Agent runs an in-process SOCKS5 server per line (no systemd service), using fwmark for policy routing into the correct tunnel.

**Tech Stack:** TypeScript/Next.js (platform), Go (agent), SQLite/Drizzle (DB), `github.com/armon/go-socks5` (SOCKS5 library)

**Spec:** `docs/superpowers/specs/2026-04-10-socks5-proxy-design.md`

---

### Task 1: Database Schema — Add SOCKS5 fields to devices table

**Files:**
- Modify: `src/lib/db/schema.ts:111-127`
- Create: `drizzle/0004_add_socks5_fields.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0004_snapshot.json`

- [ ] **Step 1: Add columns to devices schema**

In `src/lib/db/schema.ts`, add two fields after `xrayConfig`:

```typescript
  xrayConfig: text("xray_config"),
  socks5Username: text("socks5_username"),
  socks5Password: text("socks5_password"),
```

- [ ] **Step 2: Create migration SQL**

Create `drizzle/0004_add_socks5_fields.sql`:

```sql
ALTER TABLE `devices` ADD `socks5_username` text;
ALTER TABLE `devices` ADD `socks5_password` text;
```

- [ ] **Step 3: Update migration journal**

Add entry to `drizzle/meta/_journal.json`:

```json
{
  "idx": 4,
  "version": "6",
  "when": 1775800000000,
  "tag": "0004_add_socks5_fields",
  "breakpoints": true
}
```

- [ ] **Step 4: Create snapshot**

Copy `drizzle/meta/0003_snapshot.json` to `drizzle/meta/0004_snapshot.json`. Add the two new columns to the `devices` table section (after `xray_config`):

```json
"socks5_username": {
  "name": "socks5_username",
  "type": "text",
  "primaryKey": false,
  "notNull": false,
  "autoincrement": false
},
"socks5_password": {
  "name": "socks5_password",
  "type": "text",
  "primaryKey": false,
  "notNull": false,
  "autoincrement": false
}
```

- [ ] **Step 5: Build to verify schema**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): add socks5_username and socks5_password to devices table"
```

---

### Task 2: Routing Constants — Add SOCKS5 mark range

**Files:**
- Modify: `src/lib/routing-constants.ts`

- [ ] **Step 1: Add SOCKS5 mark constants**

In `src/lib/routing-constants.ts`, add after the Xray mark block:

```typescript
/** SOCKS5 fwmark routing (tables 32001-32999) */
export const SOCKS5_MARK_START = 32001;
export const SOCKS5_MARK_END = 32999;
```

- [ ] **Step 2: Add to cleanup ranges**

In the `WM_TABLE_RANGES` array, add:

```typescript
{ start: SOCKS5_MARK_START, end: SOCKS5_MARK_END },
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/routing-constants.ts
git commit -m "feat: add SOCKS5 fwmark routing constants (32001-32999)"
```

---

### Task 3: Port Allocation — Unified proxy port allocator

**Files:**
- Modify: `src/lib/xray-port.ts` → rename to `src/lib/proxy-port.ts`

The existing `getXrayPortForLine()` only counts Xray lines. We need a unified allocator that counts both Xray and SOCKS5 lines from the same port pool.

- [ ] **Step 1: Rename file and rewrite**

Rename `src/lib/xray-port.ts` to `src/lib/proxy-port.ts`. Replace contents:

```typescript
import { db } from "@/lib/db";
import { devices, lineNodes } from "@/lib/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";

export const DEFAULT_PROXY_PORT = 41443;

/**
 * Compute the proxy inbound port for a given line and protocol on a node.
 * Xray and SOCKS5 share the same port pool starting from basePort.
 * Ports are allocated in line order; each (line, protocol) pair gets one port.
 * The iteration order must match GET /api/agent/config to stay in sync.
 */
export function getProxyPortForLine(
  nodeId: number,
  lineId: number,
  protocol: "xray" | "socks5",
  basePort: number
): number {
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  if (entryLineIds.length === 0) return basePort;

  // Find which lines have xray/socks5 devices
  const proxyDevices = db
    .select({ lineId: devices.lineId, protocol: devices.protocol })
    .from(devices)
    .where(
      and(
        inArray(devices.lineId, entryLineIds),
        or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))
      )
    )
    .all();

  const xrayLineIds = new Set(proxyDevices.filter((d) => d.protocol === "xray").map((d) => d.lineId));
  const socks5LineIds = new Set(proxyDevices.filter((d) => d.protocol === "socks5").map((d) => d.lineId));

  let port = basePort;
  for (const lid of entryLineIds) {
    if (xrayLineIds.has(lid)) {
      if (lid === lineId && protocol === "xray") return port;
      port++;
    }
    if (socks5LineIds.has(lid)) {
      if (lid === lineId && protocol === "socks5") return port;
      port++;
    }
  }

  return basePort;
}

// Backwards compatibility aliases
export const DEFAULT_XRAY_PORT = DEFAULT_PROXY_PORT;
export function getXrayPortForLine(nodeId: number, lineId: number, basePort: number): number {
  return getProxyPortForLine(nodeId, lineId, "xray", basePort);
}
```

- [ ] **Step 2: Update imports across the codebase**

Find all files importing from `@/lib/xray-port` and update:

- `src/app/api/agent/config/route.ts`: change import to `from "@/lib/proxy-port"`
- `src/app/api/devices/[id]/config/route.ts`: change import to `from "@/lib/proxy-port"`

The old names `getXrayPortForLine` and `DEFAULT_XRAY_PORT` are re-exported as aliases, so existing call sites don't need code changes — only the import path changes.

- [ ] **Step 3: Delete old file**

```bash
git rm src/lib/xray-port.ts
```

- [ ] **Step 4: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/lib/proxy-port.ts src/lib/xray-port.ts src/app/api/agent/config/route.ts src/app/api/devices/\[id\]/config/route.ts
git commit -m "refactor: unify port allocation for Xray and SOCKS5"
```

---

### Task 4: Device Creation API — Support SOCKS5 protocol

**Files:**
- Modify: `src/app/api/devices/route.ts:86-181`
- Modify: `src/lib/crypto.ts` (check if random string generator exists, otherwise add)

- [ ] **Step 1: Add random credential generators**

Check if `src/lib/crypto.ts` has a random string generator. If not, add at the end of the file:

```typescript
import crypto from "crypto";

export function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}
```

- [ ] **Step 2: Update protocol validation**

In `src/app/api/devices/route.ts`, change line 93:

```typescript
// Before:
if (!protocol || !["wireguard", "xray"].includes(protocol)) {

// After:
if (!protocol || !["wireguard", "xray", "socks5"].includes(protocol)) {
```

- [ ] **Step 3: Add SOCKS5 credential generation**

After the existing `else` block (xray UUID generation, around line 134), add a new branch:

```typescript
  } else if (protocol === "socks5") {
    socks5Username = generateRandomString(8);
    socks5Password = encrypt(generateRandomString(16));
  }
```

Add variable declarations at the top (alongside `xrayUuid`):

```typescript
  let socks5Username: string | null = null;
  let socks5Password: string | null = null;
```

- [ ] **Step 4: Include in insert and returning**

Add to the `.values({})` object:

```typescript
      socks5Username,
      socks5Password,
```

Add to the `.returning({})` object:

```typescript
      socks5Username: devices.socks5Username,
```

Do NOT include `socks5Password` in returning (sensitive).

- [ ] **Step 5: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/app/api/devices/route.ts src/lib/crypto.ts
git commit -m "feat(api): support socks5 protocol in device creation"
```

---

### Task 5: Device Config API — Generate SOCKS5 connection info

**Files:**
- Modify: `src/app/api/devices/[id]/config/route.ts`

- [ ] **Step 1: Add SOCKS5 config generation**

Add import at top:

```typescript
import { getProxyPortForLine, DEFAULT_PROXY_PORT } from "@/lib/proxy-port";
import { decrypt } from "@/lib/crypto";
```

Before the final `return error("VALIDATION_ERROR", "validation.unsupportedProtocol")` (line 196), add:

```typescript
  if (protocol === "socks5") {
    if (!device.socks5Username || !device.socks5Password) {
      return error("VALIDATION_ERROR", "validation.deviceSocks5Incomplete");
    }

    let password: string;
    try {
      password = decrypt(device.socks5Password);
    } catch {
      return error("INTERNAL_ERROR", "internal.decryptDeviceFailed");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const basePort = entryNodeRow.nodeXrayPort ?? DEFAULT_PROXY_PORT;
    const socks5Port = getProxyPortForLine(entryNodeRow.nodeId, device.lineId!, "socks5", basePort);

    const proxyUrl = `socks5://${device.socks5Username}:${password}@${endpoint}:${socks5Port}`;

    return success({
      format: "socks5",
      proxyUrl,
      server: endpoint,
      port: socks5Port,
      username: device.socks5Username,
      password,
    });
  }
```

- [ ] **Step 2: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/api/devices/\[id\]/config/route.ts
git commit -m "feat(api): generate SOCKS5 connection config for devices"
```

---

### Task 6: Agent Config API — Generate SOCKS5 config section

**Files:**
- Modify: `src/app/api/agent/config/route.ts`

- [ ] **Step 1: Add SOCKS5 config generation**

After the Xray config block (after `xrayConfig = { ... }`) and before the routing config section, add SOCKS5 config generation. Import `SOCKS5_MARK_START` from routing-constants and `getProxyPortForLine` from proxy-port.

```typescript
  // ---- SOCKS5 config ----
  let socks5Config: {
    routes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[];
  } | null = null;

  if (entryLineIds.length > 0) {
    const socks5Routes: typeof socks5Config extends null ? never : NonNullable<typeof socks5Config>["routes"] = [];
    let socks5MarkCounter = SOCKS5_MARK_START;
    const proxyBasePort = node.xrayPort ?? DEFAULT_PROXY_PORT;

    for (const lineId of entryLineIds) {
      const socks5Devices = db
        .select({ socks5Username: devices.socks5Username, socks5Password: devices.socks5Password })
        .from(devices)
        .where(and(eq(devices.lineId, lineId), eq(devices.protocol, "socks5")))
        .all()
        .filter((d) => d.socks5Username && d.socks5Password);

      if (socks5Devices.length === 0) continue;

      const users = socks5Devices.map((d) => {
        let password = "";
        try { password = decrypt(d.socks5Password!); } catch {}
        return { username: d.socks5Username!, password };
      }).filter((u) => u.password);

      if (users.length === 0) continue;

      const isSingleNode = singleNodeLineIds.has(lineId);
      const tunnel = isSingleNode ? extIface : (lineToDownstreamIface.get(lineId) ?? "");
      if (!tunnel) continue;

      const port = getProxyPortForLine(nodeId, lineId, "socks5", proxyBasePort);

      socks5Routes.push({
        lineId,
        port,
        mark: socks5MarkCounter++,
        tunnel,
        users,
      });
    }

    if (socks5Routes.length > 0) {
      socks5Config = { routes: socks5Routes };
    }
  }
```

- [ ] **Step 2: Add to response object**

In the `config` object at the end, add `socks5: socks5Config`:

```typescript
  const config = {
    node: { ... },
    peers,
    tunnels: { ... },
    xray: xrayConfig,
    socks5: socks5Config,
    routing: routingConfig,
    version: node.updatedAt,
  };
```

- [ ] **Step 3: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat(api): generate SOCKS5 config in agent config endpoint"
```

---

### Task 7: Agent Go Types — Add SOCKS5 config types

**Files:**
- Modify: `agent/api/config_types.go`

- [ ] **Step 1: Add Socks5Config to ConfigData**

In `ConfigData` struct, add:

```go
Socks5 *Socks5Config  `json:"socks5"`
```

- [ ] **Step 2: Add SOCKS5 type definitions**

At the end of the file, add:

```go
// Socks5Config contains SOCKS5 proxy configuration for entry nodes.
type Socks5Config struct {
	Routes []Socks5Route `json:"routes"`
}

type Socks5Route struct {
	LineID int          `json:"lineId"`
	Port   int          `json:"port"`
	Mark   int          `json:"mark"`
	Tunnel string       `json:"tunnel"`
	Users  []Socks5User `json:"users"`
}

type Socks5User struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
```

- [ ] **Step 3: Commit**

```bash
git add agent/api/config_types.go
git commit -m "feat(agent): add SOCKS5 config type definitions"
```

---

### Task 8: Agent Go — SOCKS5 server implementation

**Files:**
- Create: `agent/socks5/server.go`

- [ ] **Step 1: Add go-socks5 dependency**

```bash
cd agent && go get github.com/armon/go-socks5 && cd ..
```

- [ ] **Step 2: Create SOCKS5 server package**

Create `agent/socks5/server.go`:

```go
package socks5

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"syscall"

	"github.com/armon/go-socks5"
	"github.com/wiremesh/agent/api"
)

// Manager manages per-line SOCKS5 servers.
type Manager struct {
	mu       sync.Mutex
	servers  map[int]*lineServer // lineId -> server
}

type lineServer struct {
	listener net.Listener
	cancel   context.CancelFunc
}

func NewManager() *Manager {
	return &Manager{
		servers: make(map[int]*lineServer),
	}
}

// Sync applies the SOCKS5 configuration. Starts/stops servers as needed.
func (m *Manager) Sync(cfg *api.Socks5Config) {
	m.mu.Lock()
	defer m.mu.Unlock()

	desired := make(map[int]api.Socks5Route)
	if cfg != nil {
		for _, r := range cfg.Routes {
			desired[r.LineID] = r
		}
	}

	// Stop servers for removed lines
	for lineId, srv := range m.servers {
		if _, ok := desired[lineId]; !ok {
			log.Printf("[socks5] Stopping server for line %d", lineId)
			srv.cancel()
			srv.listener.Close()
			delete(m.servers, lineId)
		}
	}

	// Start/update servers
	for lineId, route := range desired {
		if existing, ok := m.servers[lineId]; ok {
			// Check if port changed — restart if so
			addr := existing.listener.Addr().(*net.TCPAddr)
			if addr.Port == route.Port {
				// Update credentials in-place is not supported by go-socks5,
				// so restart the server
				existing.cancel()
				existing.listener.Close()
				delete(m.servers, lineId)
			} else {
				existing.cancel()
				existing.listener.Close()
				delete(m.servers, lineId)
			}
		}
		m.startServer(lineId, route)
	}
}

func (m *Manager) startServer(lineId int, route api.Socks5Route) {
	creds := make(socks5.StaticCredentials)
	for _, u := range route.Users {
		creds[u.Username] = u.Password
	}

	conf := &socks5.Config{
		AuthMethods: []socks5.Authenticator{socks5.UserPassAuthenticator{Credentials: creds}},
		Dial:        makeDialer(route.Mark),
	}

	server, err := socks5.New(conf)
	if err != nil {
		log.Printf("[socks5] Failed to create server for line %d: %v", lineId, err)
		return
	}

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", route.Port))
	if err != nil {
		log.Printf("[socks5] Failed to listen on port %d for line %d: %v", route.Port, lineId, err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.servers[lineId] = &lineServer{listener: listener, cancel: cancel}

	go func() {
		log.Printf("[socks5] Server started for line %d on port %d (%d users)", lineId, route.Port, len(route.Users))
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					log.Printf("[socks5] Accept error on line %d: %v", lineId, err)
					return
				}
			}
			go func() {
				if err := server.ServeConn(conn); err != nil {
					// Connection-level errors are normal (client disconnect, etc.)
				}
			}()
		}
	}()
}

// Stop shuts down all SOCKS5 servers.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for lineId, srv := range m.servers {
		srv.cancel()
		srv.listener.Close()
		delete(m.servers, lineId)
	}
	log.Println("[socks5] All servers stopped")
}

// makeDialer returns a dial function that sets SO_MARK on outgoing connections.
func makeDialer(mark int) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialer := &net.Dialer{
			Control: func(network, address string, c syscall.RawConn) error {
				return c.Control(func(fd uintptr) {
					syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, mark)
				})
			},
		}
		return dialer.DialContext(ctx, network, addr)
	}
}
```

- [ ] **Step 3: Verify Go build**

```bash
cd agent && go build ./... && cd ..
```
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add agent/socks5/ agent/go.mod agent/go.sum
git commit -m "feat(agent): implement in-process SOCKS5 server with fwmark routing"
```

---

### Task 9: Agent Integration — Wire SOCKS5 into agent lifecycle

**Files:**
- Modify: `agent/agent/agent.go`
- Modify: `agent/wg/routing.go`

- [ ] **Step 1: Add socks5Manager to Agent struct**

In `agent/agent/agent.go`, add import and field:

```go
import "github.com/wiremesh/agent/socks5"
```

Add to `Agent` struct:

```go
socks5Manager  *socks5.Manager
```

In `New()`, initialize:

```go
socks5Manager:  socks5.NewManager(),
```

- [ ] **Step 2: Add SOCKS5 sync to applyConfig**

After step 6 (Xray fwmark routing), add:

```go
	// 7. Sync SOCKS5
	if a.socks5Manager != nil {
		a.socks5Manager.Sync(cfgData.Socks5)
	}

	// 8. Sync SOCKS5 fwmark routing
	if cfgData.Socks5 != nil && len(cfgData.Socks5.Routes) > 0 {
		if err := wg.SyncSocks5Routing(cfgData.Socks5.Routes); err != nil {
			log.Printf("[agent] socks5 routing sync error: %v", err)
		}
	}
```

Update the existing step 7 (branch routing) comment to step 9.

- [ ] **Step 3: Add SOCKS5 status to log**

In the config applied log line, add SOCKS5 status:

```go
	socks5Status := "disabled"
	if cfgData.Socks5 != nil && len(cfgData.Socks5.Routes) > 0 {
		userCount := 0
		for _, r := range cfgData.Socks5.Routes {
			userCount += len(r.Users)
		}
		socks5Status = fmt.Sprintf("enabled (%d users, %d lines)", userCount, len(cfgData.Socks5.Routes))
	}
	log.Printf("[agent] Config applied. Tunnels: %d, iptables: %d, xray: %s, socks5: %s, routing: %s",
		len(a.activeTunnels), len(cfgData.Tunnels.IptablesRules), xrayStatus, socks5Status, routingStatus)
```

- [ ] **Step 4: Add SyncSocks5Routing to routing.go**

In `agent/wg/routing.go`, add after `SyncXrayRouting`:

```go
// SyncSocks5Routing applies fwmark-based routing for SOCKS5 traffic.
func SyncSocks5Routing(routes []api.Socks5Route) error {
	if len(routes) == 0 {
		return nil
	}

	for _, route := range routes {
		table := fmt.Sprintf("%d", route.Mark)
		markHex := fmt.Sprintf("0x%x", route.Mark)
		priority := table

		if _, err := Run("ip", "route", "replace", "default", "dev", route.Tunnel, "table", table); err != nil {
			log.Printf("[routing] Error adding socks5 route table %s: %v", table, err)
			continue
		}

		if _, err := Run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", priority); err != nil {
			if !strings.Contains(err.Error(), "File exists") {
				log.Printf("[routing] Error adding socks5 fwmark rule %s: %v", markHex, err)
				continue
			}
		}

		log.Printf("[routing] SOCKS5: fwmark %s → %s (wm-socks5-line-%d, table %s, priority %s)",
			markHex, route.Tunnel, route.LineID, table, priority)
	}

	log.Printf("[routing] SOCKS5 routing configured: %d lines", len(routes))
	return nil
}
```

- [ ] **Step 5: Add SOCKS5 stop to agent shutdown**

Find the `Shutdown()` or `Stop()` method in `agent/agent/agent.go`. Add:

```go
if a.socks5Manager != nil {
    a.socks5Manager.Stop()
}
```

- [ ] **Step 6: Verify Go build**

```bash
cd agent && go build ./... && cd ..
```
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add agent/agent/agent.go agent/wg/routing.go
git commit -m "feat(agent): integrate SOCKS5 server into agent lifecycle"
```

---

### Task 10: Frontend — Device creation with SOCKS5 protocol

**Files:**
- Modify: `src/app/(dashboard)/devices/new/page.tsx`
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add SOCKS5 to protocol select**

In `src/app/(dashboard)/devices/new/page.tsx`, find the protocol `<Select>` component. Add a new `<SelectItem>`:

```tsx
<SelectItem value="socks5">SOCKS5</SelectItem>
```

- [ ] **Step 2: No additional UI needed**

SOCKS5 doesn't require user input beyond name + protocol + line (same as Xray). Credentials are auto-generated by the backend.

- [ ] **Step 3: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/devices/new/page.tsx
git commit -m "feat(ui): add SOCKS5 protocol option to device creation"
```

---

### Task 11: Frontend — SOCKS5 device config display

**Files:**
- Modify: `src/app/(dashboard)/devices/[id]/config/page.tsx`
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add SOCKS5 config display**

In `src/app/(dashboard)/devices/[id]/config/page.tsx`, find where Xray config is rendered (checking `configData?.format`). Add a new block for SOCKS5:

```tsx
{configData?.format === "socks5" && (
  <Card>
    <CardHeader>
      <CardTitle>{t("configTitle", { format: "SOCKS5" })}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-20 shrink-0">{t("proxyUrl")}</span>
          <code className="text-xs bg-muted px-2 py-1 rounded break-all flex-1">{configData.proxyUrl}</code>
          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(configData.proxyUrl)}>
            {tc("copy")}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-20 shrink-0">{t("address")}</span>
          <span>{configData.server}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-20 shrink-0">{t("port")}</span>
          <span>{configData.port}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-20 shrink-0">{t("username")}</span>
          <code className="text-xs bg-muted px-2 py-1 rounded">{configData.username}</code>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-20 shrink-0">{t("password")}</span>
          <code className="text-xs bg-muted px-2 py-1 rounded">{configData.password}</code>
        </div>
      </div>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 2: Add translations**

In `messages/zh-CN.json` under `deviceConfig`, add:

```json
"proxyUrl": "代理地址",
"username": "用户名",
"password": "密码",
"socks5Hint": "在浏览器或系统代理设置中配置 SOCKS5 代理"
```

In `messages/en.json` under `deviceConfig`, add:

```json
"proxyUrl": "Proxy URL",
"username": "Username",
"password": "Password",
"socks5Hint": "Configure SOCKS5 proxy in your browser or system proxy settings"
```

- [ ] **Step 3: Update node port label translations**

In `messages/zh-CN.json` under `nodeNew`, change:

```json
"xrayStartPort": "代理起始端口",
"xrayPortHint": "Xray 和 SOCKS5 共用端口池，每条线路自动分配独立端口（如 41443、41444、41445...），请确保防火墙放行对应端口"
```

In `messages/en.json` under `nodeNew`, change:

```json
"xrayStartPort": "Proxy Base Port",
"xrayPortHint": "Xray and SOCKS5 share the port pool. Each line gets a unique port (e.g., 41443, 41444, 41445...). Ensure your firewall allows these ports."
```

- [ ] **Step 4: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/devices/\[id\]/config/page.tsx messages/zh-CN.json messages/en.json
git commit -m "feat(ui): add SOCKS5 config display and update port label translations"
```

---

### Task 12: Agent Routing Cleanup — Add SOCKS5 range to cleanup

**Files:**
- Modify: `agent/wg/routing.go` (constants section)
- Modify: `agent/routing/manager.go` (cleanup)

- [ ] **Step 1: Add SOCKS5 routing constants to Agent Go**

In `agent/wg/routing.go`, add after the xray constants:

```go
socks5RouteTableStart = 32001
socks5RouteTableEnd   = 32999
```

- [ ] **Step 2: Add SOCKS5 table cleanup to SyncRouting**

In `agent/wg/routing.go`'s `SyncRouting` function, find where xray tables are cleaned. Add similar cleanup for SOCKS5 tables:

```go
// Clean SOCKS5 tables
for i := socks5RouteTableStart; i <= socks5RouteTableEnd; i++ {
    exec.Command("ip", "rule", "del", "fwmark", fmt.Sprintf("0x%x", i)).CombinedOutput()
    exec.Command("ip", "route", "flush", "table", fmt.Sprintf("%d", i)).CombinedOutput()
}
```

Note: Check the existing cleanup pattern in the code and follow it exactly. The cleanup may be in `SyncRouting` or in a separate cleanup function. Match the existing approach.

- [ ] **Step 3: Add NAT masquerade for SOCKS5**

In `agent/routing/manager.go`, in the Xray MASQUERADE section, add a similar rule for SOCKS5. Find the `addNatRule` call with `wm-xray-masq` and add below it:

```go
addNatRule("-A POSTROUTING -o wm-tun+ -j MASQUERADE -m comment --comment wm-socks5-masq")
```

Or, if SOCKS5 routes exist, add the rule conditionally. Check if the existing Xray masquerade is conditional and follow the same pattern.

- [ ] **Step 4: Verify Go build**

```bash
cd agent && go build ./... && cd ..
```
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add agent/wg/routing.go agent/routing/manager.go
git commit -m "feat(agent): add SOCKS5 routing table cleanup and NAT masquerade"
```

---

### Task 13: Final Integration — Build and verify everything

**Files:** (none — verification only)

- [ ] **Step 1: Full platform build**

```bash
npm run build 2>&1 | tail -10
```
Expected: Build succeeds with no errors

- [ ] **Step 2: Full agent build**

```bash
cd agent && go build ./... && cd ..
```
Expected: Build succeeds with no errors

- [ ] **Step 3: Verify no hardcoded "eth0" regression**

```bash
# Should only appear in comments, not in template literals or string assignments
grep -rn '"eth0"' src/app/api/agent/config/route.ts
```
Expected: No matches (only `extIface` variable used)

- [ ] **Step 4: Commit any final fixes**

If any issues were found, fix and commit.

- [ ] **Step 5: Final commit**

```bash
git log --oneline -10
```

Verify all SOCKS5 commits are present and the feature is complete.
