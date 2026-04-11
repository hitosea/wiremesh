# Agent 生命周期优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the WireMesh agent install/upgrade/uninstall lifecycle with version management, remote uninstall on node deletion, auto-upgrade via SSE, and install script hardening.

**Architecture:** Incremental enhancement on existing architecture. Agent gets version injection at build time, new SSE event handlers for lifecycle operations, and enhanced status reporting. Management platform gets new API endpoints for triggering upgrades and improved node deletion flow with remote uninstall. Install/uninstall scripts get reliability improvements.

**Tech Stack:** Go (agent), Next.js App Router + TypeScript (server), SQLite + Drizzle ORM (database), shadcn/ui (frontend), Docker (build)

**Spec:** `docs/superpowers/specs/2026-04-11-agent-lifecycle-optimization-design.md`

---

## File Structure

### New Files
- `agent/lifecycle/upgrade.go` — Agent self-upgrade logic (download, verify, replace, restart)
- `agent/lifecycle/uninstall.go` — Agent self-uninstall logic (download script, nohup execute)
- `src/app/api/nodes/[id]/upgrade/route.ts` — Single node Agent upgrade trigger
- `src/app/api/nodes/[id]/xray-upgrade/route.ts` — Single node Xray upgrade trigger
- `src/app/api/nodes/batch-upgrade/route.ts` — Batch upgrade trigger
- `worker/pending-delete-cleaner.js` — Cleanup stale pendingDelete records
- `drizzle/0005_add_agent_lifecycle_fields.sql` — Migration for new columns

### Modified Files
- `agent/main.go` — Add Version variable, print on startup
- `agent/agent/agent.go` — Handle new SSE events, pass version to status report, add upgrade/uninstall triggers
- `agent/api/status.go` — Add version fields to StatusReport struct
- `agent/api/config_types.go` — Add PendingDelete field to ConfigData
- `agent/api/client.go` — Add methods for downloading binary, HEAD request, downloading uninstall script
- `agent/collector/collector.go` — Collect agent/xray version info
- `agent/xray/manager.go` — Add GetVersion() function
- `Dockerfile` — Add AGENT_VERSION build arg, ldflags, checksum generation
- `src/lib/db/schema.ts` — Add agentVersion, xrayVersion, pendingDelete to nodes table
- `src/app/api/agent/status/route.ts` — Accept and store version fields
- `src/app/api/agent/config/route.ts` — Include pending_delete in response
- `src/app/api/agent/binary/route.ts` — Add version/checksum headers, HEAD support
- `src/app/api/agent/xray/route.ts` — Add version/checksum headers, HEAD support
- `src/app/api/agent/sse/route.ts` — Check pendingDelete on connection, send node_delete
- `src/app/api/nodes/[id]/route.ts` — DELETE handler: send SSE node_delete, mark pendingDelete
- `src/app/api/nodes/route.ts` — Include agentVersion, xrayVersion in list response
- `src/app/api/uninstall-script/route.ts` — Reorder disable/stop, batch iptables, logging
- `src/app/api/nodes/[id]/script/route.ts` — Add health check, retry, checksum validation
- `src/lib/sse-manager.ts` — No changes needed (sendEvent already exists)
- `src/app/(dashboard)/nodes/page.tsx` — Add version columns, upgrade buttons, delete dialog text
- `worker/index.js` — Add pending-delete cleaner schedule
- `messages/en.json` — Add i18n keys for new UI text
- `messages/zh-CN.json` — Add i18n keys for new UI text

---

### Task 1: Database Migration

**Files:**
- Modify: `src/lib/db/schema.ts:31-50`
- Create: `drizzle/0005_add_agent_lifecycle_fields.sql`

- [ ] **Step 1: Add fields to schema.ts**

In `src/lib/db/schema.ts`, add three fields to the `nodes` table definition, after the `errorMessage` field (line 47):

```typescript
  agentVersion: text("agent_version"),
  xrayVersion: text("xray_version"),
  pendingDelete: integer("pending_delete", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 2: Create migration SQL**

Create `drizzle/0005_add_agent_lifecycle_fields.sql`:

```sql
ALTER TABLE nodes ADD COLUMN agent_version text;
ALTER TABLE nodes ADD COLUMN xray_version text;
ALTER TABLE nodes ADD COLUMN pending_delete integer NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Run migration**

Run: `npm run db:migrate`
Expected: Migration applies successfully, no errors.

- [ ] **Step 4: Verify**

Run: `sqlite3 data/wiremesh.db ".schema nodes" | grep -E "agent_version|xray_version|pending_delete"`
Expected: All three columns exist.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0005_add_agent_lifecycle_fields.sql
git commit -m "feat: add agent_version, xray_version, pending_delete to nodes table"
```

---

### Task 2: Dockerfile — Version Injection and Checksum

**Files:**
- Modify: `Dockerfile:15-24`

- [ ] **Step 1: Add AGENT_VERSION build arg and ldflags to agent-builder stage**

Replace the agent-builder stage in `Dockerfile` (lines 15-24) with:

```dockerfile
# Build Agent (both architectures)
FROM golang:1.25-alpine AS agent-builder
ARG AGENT_VERSION=dev
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-X main.Version=${AGENT_VERSION}" -o wiremesh-agent . && \
    tar czf wiremesh-agent-linux-amd64.tar.gz wiremesh-agent && \
    sha256sum wiremesh-agent-linux-amd64.tar.gz > wiremesh-agent-linux-amd64.tar.gz.sha256 && \
    rm wiremesh-agent && \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "-X main.Version=${AGENT_VERSION}" -o wiremesh-agent . && \
    tar czf wiremesh-agent-linux-arm64.tar.gz wiremesh-agent && \
    sha256sum wiremesh-agent-linux-arm64.tar.gz > wiremesh-agent-linux-arm64.tar.gz.sha256 && \
    rm wiremesh-agent
```

- [ ] **Step 2: Copy checksum files in runtime stage**

After the existing COPY lines for agent binaries (lines 46-47), add:

```dockerfile
COPY --from=agent-builder /agent/wiremesh-agent-linux-amd64.tar.gz.sha256 ./public/agent/
COPY --from=agent-builder /agent/wiremesh-agent-linux-arm64.tar.gz.sha256 ./public/agent/
```

- [ ] **Step 3: Add Xray checksum generation**

In the xray-downloader stage, after each `tar czf` line, add checksum generation. Replace lines 4-13:

```dockerfile
FROM alpine:latest AS xray-downloader
ARG XRAY_VERSION=v26.3.27
RUN apk add --no-cache curl unzip && \
    mkdir -p /out && \
    curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" -o /tmp/xray-amd64.zip && \
    unzip -o /tmp/xray-amd64.zip xray -d /tmp/xray-amd64 && \
    tar czf /out/xray-linux-amd64.tar.gz -C /tmp/xray-amd64 xray && \
    sha256sum /out/xray-linux-amd64.tar.gz > /out/xray-linux-amd64.tar.gz.sha256 && \
    curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-arm64-v8a.zip" -o /tmp/xray-arm64.zip && \
    unzip -o /tmp/xray-arm64.zip xray -d /tmp/xray-arm64 && \
    tar czf /out/xray-linux-arm64.tar.gz -C /tmp/xray-arm64 xray && \
    sha256sum /out/xray-linux-arm64.tar.gz > /out/xray-linux-arm64.tar.gz.sha256
```

And copy checksums in runtime stage after xray binary copies:

```dockerfile
COPY --from=xray-downloader /out/xray-linux-amd64.tar.gz.sha256 ./public/xray/
COPY --from=xray-downloader /out/xray-linux-arm64.tar.gz.sha256 ./public/xray/
```

- [ ] **Step 4: Also write the XRAY_VERSION to a file for version header**

In the xray-downloader stage, add at the end of the RUN command:

```dockerfile
    echo -n "${XRAY_VERSION}" > /out/xray-version.txt
```

And add to COPY in runtime:

```dockerfile
COPY --from=xray-downloader /out/xray-version.txt ./public/xray/
```

- [ ] **Step 5: Write AGENT_VERSION to file for version header**

In the agent-builder stage, add at the end of the RUN command:

```dockerfile
    echo -n "${AGENT_VERSION}" > agent-version.txt
```

And add to COPY in runtime:

```dockerfile
COPY --from=agent-builder /agent/agent-version.txt ./public/agent/
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile
git commit -m "feat: add version injection and checksum generation to Dockerfile"
```

---

### Task 3: Agent Version Variable

**Files:**
- Modify: `agent/main.go:1-43`

- [ ] **Step 1: Add Version variable and print on startup**

In `agent/main.go`, add the Version variable before `main()` and update the startup log:

```go
var Version = "dev"

func main() {
	configPath := flag.String("config", config.DefaultConfigPath, "path to agent config file")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("WireMesh Agent %s starting...", Version)
```

- [ ] **Step 2: Commit**

```bash
git add agent/main.go
git commit -m "feat: add version variable to agent binary"
```

---

### Task 4: Agent Status Reporting — Version Fields

**Files:**
- Modify: `agent/api/status.go:1-24`
- Modify: `agent/xray/manager.go` (add GetVersion)
- Modify: `agent/collector/collector.go:26-36`

- [ ] **Step 1: Add version fields to StatusReport**

In `agent/api/status.go`, add three fields to the `StatusReport` struct:

```go
type StatusReport struct {
	IsOnline        bool              `json:"is_online"`
	Latency         *int              `json:"latency,omitempty"`
	Transfers       []TransferReport  `json:"transfers,omitempty"`
	Handshakes      []HandshakeReport `json:"handshakes,omitempty"`
	XrayOnlineUsers []string          `json:"xray_online_users,omitempty"`
	AgentVersion    string            `json:"agent_version,omitempty"`
	XrayVersion     string            `json:"xray_version,omitempty"`
	XrayRunning     bool              `json:"xray_running"`
}
```

- [ ] **Step 2: Add GetVersion to xray manager**

In `agent/xray/manager.go`, add a function to get Xray version:

```go
func GetVersion() string {
	out, err := exec.Command("wiremesh-xray", "version").CombinedOutput()
	if err != nil {
		return ""
	}
	// Xray outputs "Xray 1.8.x (Xray, Penetrates Everything.) ..."
	// Extract first line, parse version
	line := strings.SplitN(string(out), "\n", 2)[0]
	parts := strings.Fields(line)
	if len(parts) >= 2 {
		return parts[1]
	}
	return strings.TrimSpace(line)
}
```

Add `"strings"` to imports if not already present.

- [ ] **Step 3: Update collector to include version info**

The `Collect` function in `agent/collector/collector.go` needs to accept the agent version string and populate all fields. Change the signature and body:

```go
func Collect(serverURL string, agentVersion string) *api.StatusReport {
	report := &api.StatusReport{IsOnline: true}
	latency := measureLatency(serverURL)
	if latency >= 0 {
		report.Latency = &latency
	}
	report.Transfers = collectTransfers()
	report.Handshakes = collectHandshakes()
	report.XrayOnlineUsers = collectXrayOnlineUsers()
	report.AgentVersion = agentVersion
	report.XrayVersion = xray.GetVersion()
	report.XrayRunning = xray.IsRunning()
	return report
}
```

Add `"github.com/wiremesh/agent/xray"` to imports.

- [ ] **Step 4: Export IsRunning from xray manager**

In `agent/xray/manager.go`, change `isRunning` to `IsRunning` (capitalize):

```go
func IsRunning() bool {
	return exec.Command("systemctl", "is-active", "--quiet", XrayService).Run() == nil
}
```

Update all internal callers of `isRunning()` to `IsRunning()`.

- [ ] **Step 5: Update agent.go to pass version to collector**

In `agent/agent/agent.go`, update `reportStatus()` to pass the version:

```go
func (a *Agent) reportStatus() {
	report := collector.Collect(a.cfg.ServerURL, main.Version)
```

Wait — `main.Version` isn't accessible from the `agent` package. Instead, pass it through the Agent struct. Modify the Agent struct and constructor:

In `agent/agent/agent.go`, add `version` field to Agent struct:

```go
type Agent struct {
	cfg            *config.Config
	client         *api.Client
	sse            *api.SSEClient
	activeTunnels  map[string]wg.ActiveTunnel
	socks5Manager  *socks5.Manager
	routingManager *routing.Manager
	lastVersion    string
	version        string
	ctx            context.Context
	cancel         context.CancelFunc
}
```

Update `New()` to accept version:

```go
func New(cfg *config.Config, version string) *Agent {
	ctx, cancel := context.WithCancel(context.Background())
	return &Agent{
		cfg:            cfg,
		client:         api.NewClient(cfg.ServerURL, cfg.Token),
		activeTunnels:  make(map[string]wg.ActiveTunnel),
		socks5Manager:  socks5.NewManager(),
		routingManager: routing.NewManager(),
		version:        version,
		ctx:            ctx,
		cancel:         cancel,
	}
}
```

Update `reportStatus()`:

```go
func (a *Agent) reportStatus() {
	report := collector.Collect(a.cfg.ServerURL, a.version)
	if err := a.client.ReportStatus(report); err != nil {
		log.Printf("[agent] Status report failed: %v", err)
	} else {
		log.Printf("[agent] Status reported (latency: %v, transfers: %d, handshakes: %d)",
			report.Latency, len(report.Transfers), len(report.Handshakes))
	}
}
```

Update `main.go` to pass version:

```go
a := agent.New(cfg, Version)
```

- [ ] **Step 6: Commit**

```bash
git add agent/api/status.go agent/xray/manager.go agent/collector/collector.go agent/agent/agent.go agent/main.go
git commit -m "feat: agent reports version info in status"
```

---

### Task 5: Server — Accept Version in Status Endpoint

**Files:**
- Modify: `src/app/api/agent/status/route.ts:12-54`

- [ ] **Step 1: Update request body type and store version fields**

In `src/app/api/agent/status/route.ts`, update the body type (line 18-24):

```typescript
  const body = await request.json() as {
    is_online: boolean;
    latency?: number;
    transfers?: Transfer[];
    handshakes?: Handshake[];
    xray_online_users?: string[];
    agent_version?: string;
    xray_version?: string;
    xray_running?: boolean;
  };
```

Update the destructuring (line 26):

```typescript
  const { is_online, latency, transfers = [], handshakes = [], xray_online_users = [], agent_version, xray_version } = body;
```

Update the node status update (lines 48-54) to include version fields:

```typescript
  // Update node status and version info
  db.update(nodes)
    .set({
      status: is_online ? "online" : "offline",
      ...(agent_version && { agentVersion: agent_version }),
      ...(xray_version && { xrayVersion: xray_version }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/agent/status/route.ts
git commit -m "feat: store agent/xray version from status reports"
```

---

### Task 6: Server — Binary Endpoints Version Headers and HEAD Support

**Files:**
- Modify: `src/app/api/agent/binary/route.ts`
- Modify: `src/app/api/agent/xray/route.ts`

- [ ] **Step 1: Update agent binary endpoint**

Replace `src/app/api/agent/binary/route.ts` entirely:

```typescript
import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const VALID_ARCHS = ["amd64", "arm64"];

function getFileInfo(arch: string) {
  const filename = `wiremesh-agent-linux-${arch}.tar.gz`;
  const filePath = path.join(process.cwd(), "public", "agent", filename);
  const versionPath = path.join(process.cwd(), "public", "agent", "agent-version.txt");
  const checksumPath = filePath + ".sha256";

  if (!fs.existsSync(filePath)) return null;

  const version = fs.existsSync(versionPath) ? fs.readFileSync(versionPath, "utf-8").trim() : "unknown";
  let checksum = "";
  if (fs.existsSync(checksumPath)) {
    checksum = fs.readFileSync(checksumPath, "utf-8").trim().split(/\s+/)[0];
  } else {
    const buffer = fs.readFileSync(filePath);
    checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  }

  return { filePath, filename, version, checksum };
}

function buildHeaders(info: { filename: string; version: string; checksum: string; contentLength?: number }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${info.filename}"`,
    "X-Agent-Version": info.version,
    "X-Agent-Checksum": `sha256:${info.checksum}`,
  };
  if (info.contentLength !== undefined) {
    headers["Content-Length"] = info.contentLength.toString();
  }
  return headers;
}

export async function HEAD(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";
  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}` } },
      { status: 400 }
    );
  }
  const info = getFileInfo(arch);
  if (!info) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Agent binary not found" } },
      { status: 404 }
    );
  }
  return new Response(null, { headers: buildHeaders(info) });
}

export async function GET(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";
  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}` } },
      { status: 400 }
    );
  }
  const info = getFileInfo(arch);
  if (!info) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Agent binary not found" } },
      { status: 404 }
    );
  }
  const buffer = fs.readFileSync(info.filePath);
  return new Response(buffer, {
    headers: buildHeaders({ ...info, contentLength: buffer.length }),
  });
}
```

- [ ] **Step 2: Update xray binary endpoint**

Apply the same pattern to `src/app/api/agent/xray/route.ts`, changing:
- `"agent"` directory → `"xray"` directory
- `wiremesh-agent` → `xray`
- `agent-version.txt` → `xray-version.txt`
- `X-Agent-Version` → `X-Xray-Version`
- `X-Agent-Checksum` → `X-Xray-Checksum`

```typescript
import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const VALID_ARCHS = ["amd64", "arm64"];

function getFileInfo(arch: string) {
  const filename = `xray-linux-${arch}.tar.gz`;
  const filePath = path.join(process.cwd(), "public", "xray", filename);
  const versionPath = path.join(process.cwd(), "public", "xray", "xray-version.txt");
  const checksumPath = filePath + ".sha256";

  if (!fs.existsSync(filePath)) return null;

  const version = fs.existsSync(versionPath) ? fs.readFileSync(versionPath, "utf-8").trim() : "unknown";
  let checksum = "";
  if (fs.existsSync(checksumPath)) {
    checksum = fs.readFileSync(checksumPath, "utf-8").trim().split(/\s+/)[0];
  } else {
    const buffer = fs.readFileSync(filePath);
    checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  }

  return { filePath, filename, version, checksum };
}

function buildHeaders(info: { filename: string; version: string; checksum: string; contentLength?: number }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${info.filename}"`,
    "X-Xray-Version": info.version,
    "X-Xray-Checksum": `sha256:${info.checksum}`,
  };
  if (info.contentLength !== undefined) {
    headers["Content-Length"] = info.contentLength.toString();
  }
  return headers;
}

export async function HEAD(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";
  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}` } },
      { status: 400 }
    );
  }
  const info = getFileInfo(arch);
  if (!info) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Xray binary not found" } },
      { status: 404 }
    );
  }
  return new Response(null, { headers: buildHeaders(info) });
}

export async function GET(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";
  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}` } },
      { status: 400 }
    );
  }
  const info = getFileInfo(arch);
  if (!info) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Xray binary not found" } },
      { status: 404 }
    );
  }
  const buffer = fs.readFileSync(info.filePath);
  return new Response(buffer, {
    headers: buildHeaders({ ...info, contentLength: buffer.length }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/binary/route.ts src/app/api/agent/xray/route.ts
git commit -m "feat: add version/checksum headers and HEAD support to binary endpoints"
```

---

### Task 7: Uninstall Script Improvements

**Files:**
- Modify: `src/app/api/uninstall-script/route.ts`

- [ ] **Step 1: Read the current uninstall script**

Read `src/app/api/uninstall-script/route.ts` fully to understand the exact line references before modifying.

- [ ] **Step 2: Reorder disable before stop in Phase 2**

In the generated script's Phase 2 (services stop), change the order so `disable` comes before `stop` for both services:

```bash
# Phase 2: Stop and disable services
info "Disabling and stopping WireMesh services..."
systemctl disable wiremesh-agent 2>/dev/null || true
systemctl stop wiremesh-agent 2>/dev/null || true
ok "wiremesh-agent disabled and stopped"
systemctl disable wiremesh-xray 2>/dev/null || true
systemctl stop wiremesh-xray 2>/dev/null || true
ok "wiremesh-xray disabled and stopped"
```

- [ ] **Step 3: Replace iptables loop cleanup with batch cleanup**

Replace the `clean_iptables_chain` function and its calls with batch cleanup:

```bash
# Phase 4: Clean iptables rules (batch)
info "Cleaning iptables rules..."
for TABLE in filter nat mangle; do
  if iptables-save -t "$TABLE" 2>/dev/null | grep -q 'wm-'; then
    iptables-save -t "$TABLE" | grep -v 'wm-' | iptables-restore -T "$TABLE" 2>/dev/null || true
    ok "Cleaned wm- rules from $TABLE table"
  fi
done
```

- [ ] **Step 4: Add logging**

At the beginning of the generated script (after `set -e` and color definitions), add:

```bash
# Log output
LOG_FILE="/var/log/wiremesh-uninstall.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== WireMesh uninstall started at $(date) ==="
```

At the end of the script, before the final success message, add log cleanup:

```bash
# Clean up logs (unless --keep-logs)
if [ "${1:-}" != "--keep-logs" ]; then
  rm -f /var/log/wiremesh-install.log
  rm -f /var/log/wiremesh-uninstall.log
fi
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/uninstall-script/route.ts
git commit -m "feat: improve uninstall script — disable before stop, batch iptables, logging"
```

---

### Task 8: Agent Config — PendingDelete Field

**Files:**
- Modify: `agent/api/config_types.go:8-16`
- Modify: `src/app/api/agent/config/route.ts:576-598`

- [ ] **Step 1: Add PendingDelete to ConfigData**

In `agent/api/config_types.go`, add to the `ConfigData` struct:

```go
type ConfigData struct {
	Node          NodeConfig     `json:"node"`
	Peers         []PeerConfig   `json:"peers"`
	Tunnels       TunnelConfig   `json:"tunnels"`
	Xray          *XrayConfig    `json:"xray"`
	Socks5        *Socks5Config  `json:"socks5"`
	Routing       *RoutingConfig `json:"routing"`
	Version       string         `json:"version"`
	PendingDelete bool           `json:"pending_delete"`
}
```

- [ ] **Step 2: Include pending_delete in config response**

In `src/app/api/agent/config/route.ts`, update the config object (around line 576):

```typescript
  const config = {
    node: {
      id: node.id,
      name: node.name,
      ip: node.ip,
      wgAddress: node.wgAddress,
      wgPort: node.port,
      wgPrivateKey,
    },
    peers,
    tunnels: {
      interfaces,
      iptablesRules,
      deviceRoutes,
    },
    xray: xrayConfig,
    socks5: socks5Config,
    routing: routingConfig,
    version: node.updatedAt,
    pending_delete: !!node.pendingDelete,
  };
```

- [ ] **Step 3: Commit**

```bash
git add agent/api/config_types.go src/app/api/agent/config/route.ts
git commit -m "feat: include pending_delete in agent config response"
```

---

### Task 9: Agent Lifecycle Module — Uninstall

**Files:**
- Create: `agent/lifecycle/uninstall.go`
- Modify: `agent/api/client.go`

- [ ] **Step 1: Add FetchUninstallScript to API client**

In `agent/api/client.go`, add:

```go
func (c *Client) FetchUninstallScript() ([]byte, error) {
	resp, err := c.doRequest("GET", "/api/uninstall-script", nil)
	if err != nil {
		return nil, fmt.Errorf("fetch uninstall script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch uninstall script: status %d: %s", resp.StatusCode, string(body))
	}
	return io.ReadAll(resp.Body)
}
```

- [ ] **Step 2: Create uninstall.go**

Create `agent/lifecycle/uninstall.go`:

```go
package lifecycle

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"syscall"

	"github.com/wiremesh/agent/api"
)

// RunUninstall downloads the uninstall script from the management platform
// and executes it as a detached process. The script will stop the agent
// service, so the agent process will be killed by the script.
func RunUninstall(client *api.Client) error {
	log.Println("[lifecycle] Downloading uninstall script...")
	script, err := client.FetchUninstallScript()
	if err != nil {
		return fmt.Errorf("download uninstall script: %w", err)
	}

	scriptPath := "/tmp/wiremesh-uninstall.sh"
	if err := os.WriteFile(scriptPath, script, 0755); err != nil {
		return fmt.Errorf("write uninstall script: %w", err)
	}

	log.Println("[lifecycle] Starting uninstall script as detached process...")
	cmd := exec.Command("nohup", "bash", scriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start uninstall script: %w", err)
	}

	log.Printf("[lifecycle] Uninstall script started (PID %d), agent will be stopped by the script", cmd.Process.Pid)
	return nil
}
```

- [ ] **Step 3: Commit**

```bash
git add agent/lifecycle/uninstall.go agent/api/client.go
git commit -m "feat: agent lifecycle uninstall module"
```

---

### Task 10: Agent Lifecycle Module — Upgrade

**Files:**
- Create: `agent/lifecycle/upgrade.go`
- Modify: `agent/api/client.go`

- [ ] **Step 1: Add binary download methods to API client**

In `agent/api/client.go`, add:

```go
type BinaryInfo struct {
	Version  string
	Checksum string
}

func (c *Client) FetchBinaryInfo(endpoint string) (*BinaryInfo, error) {
	resp, err := c.doRequest("HEAD", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch binary info: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("fetch binary info: status %d", resp.StatusCode)
	}
	version := resp.Header.Get("X-Agent-Version")
	if version == "" {
		version = resp.Header.Get("X-Xray-Version")
	}
	checksum := resp.Header.Get("X-Agent-Checksum")
	if checksum == "" {
		checksum = resp.Header.Get("X-Xray-Checksum")
	}
	return &BinaryInfo{Version: version, Checksum: checksum}, nil
}

func (c *Client) DownloadBinary(endpoint string) ([]byte, error) {
	resp, err := c.doRequest("GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("download binary: status %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
```

- [ ] **Step 2: Create upgrade.go**

Create `agent/lifecycle/upgrade.go`:

```go
package lifecycle

import (
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/wiremesh/agent/api"
)

const (
	agentBinaryPath  = "/usr/local/bin/wiremesh-agent"
	agentBackupPath  = "/usr/local/bin/wiremesh-agent.backup"
	xrayBinaryPath   = "/usr/local/bin/wiremesh-xray"
	xrayBackupPath   = "/usr/local/bin/wiremesh-xray.backup"
	xrayService      = "wiremesh-xray"
)

// UpgradeAgent downloads a new agent binary, verifies checksum, replaces the current binary,
// and returns true if the caller should trigger a graceful restart (a.Stop()).
func UpgradeAgent(client *api.Client, currentVersion string) (bool, error) {
	arch := runtime.GOARCH
	endpoint := fmt.Sprintf("/api/agent/binary?arch=%s", arch)

	log.Println("[lifecycle] Checking for agent update...")
	info, err := client.FetchBinaryInfo(endpoint)
	if err != nil {
		return false, fmt.Errorf("check agent version: %w", err)
	}

	if info.Version == currentVersion {
		log.Printf("[lifecycle] Agent already at version %s, skipping", currentVersion)
		return false, nil
	}

	log.Printf("[lifecycle] Upgrading agent from %s to %s...", currentVersion, info.Version)

	data, err := client.DownloadBinary(endpoint)
	if err != nil {
		return false, fmt.Errorf("download agent binary: %w", err)
	}

	if err := verifyChecksum(data, info.Checksum); err != nil {
		return false, fmt.Errorf("checksum verification failed: %w", err)
	}

	if err := extractAndReplace(data, agentBinaryPath, agentBackupPath); err != nil {
		return false, fmt.Errorf("replace agent binary: %w", err)
	}

	log.Printf("[lifecycle] Agent binary replaced. Restart required.")
	return true, nil
}

// UpgradeXray downloads a new Xray binary, verifies checksum, replaces, and restarts the Xray service.
func UpgradeXray(client *api.Client) error {
	arch := runtime.GOARCH
	endpoint := fmt.Sprintf("/api/agent/xray?arch=%s", arch)

	log.Println("[lifecycle] Checking for Xray update...")
	info, err := client.FetchBinaryInfo(endpoint)
	if err != nil {
		return fmt.Errorf("check xray version: %w", err)
	}

	log.Printf("[lifecycle] Upgrading Xray to %s...", info.Version)

	data, err := client.DownloadBinary(endpoint)
	if err != nil {
		return fmt.Errorf("download xray binary: %w", err)
	}

	if err := verifyChecksum(data, info.Checksum); err != nil {
		return fmt.Errorf("checksum verification failed: %w", err)
	}

	if err := extractAndReplace(data, xrayBinaryPath, xrayBackupPath); err != nil {
		return fmt.Errorf("replace xray binary: %w", err)
	}

	log.Println("[lifecycle] Xray binary replaced, restarting service...")
	if err := exec.Command("systemctl", "restart", xrayService).Run(); err != nil {
		return fmt.Errorf("restart xray service: %w", err)
	}

	log.Println("[lifecycle] Xray upgrade complete")
	return nil
}

func verifyChecksum(data []byte, expected string) error {
	if expected == "" {
		log.Println("[lifecycle] Warning: no checksum provided, skipping verification")
		return nil
	}
	// Expected format: "sha256:abcdef..."
	expected = strings.TrimPrefix(expected, "sha256:")
	actual := fmt.Sprintf("%x", sha256.Sum256(data))
	if actual != expected {
		return fmt.Errorf("expected %s, got %s", expected, actual)
	}
	log.Println("[lifecycle] Checksum verified")
	return nil
}

func extractAndReplace(tarGzData []byte, targetPath, backupPath string) error {
	// Write tar.gz to temp file
	tmpTarGz := targetPath + ".new.tar.gz"
	if err := os.WriteFile(tmpTarGz, tarGzData, 0644); err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}
	defer os.Remove(tmpTarGz)

	// Extract to temp location
	tmpDir := targetPath + ".new.d"
	os.MkdirAll(tmpDir, 0755)
	defer os.RemoveAll(tmpDir)

	if out, err := exec.Command("tar", "-xzf", tmpTarGz, "-C", tmpDir).CombinedOutput(); err != nil {
		return fmt.Errorf("extract tar.gz: %s: %w", string(out), err)
	}

	// Find the binary in extracted files (the tar contains a single binary)
	entries, err := os.ReadDir(tmpDir)
	if err != nil || len(entries) == 0 {
		return fmt.Errorf("no files in extracted archive")
	}
	extractedPath := tmpDir + "/" + entries[0].Name()

	// Backup current binary
	if _, err := os.Stat(targetPath); err == nil {
		if err := copyFile(targetPath, backupPath); err != nil {
			return fmt.Errorf("backup current binary: %w", err)
		}
		log.Printf("[lifecycle] Backed up %s to %s", targetPath, backupPath)
	}

	// Replace binary
	if err := copyFile(extractedPath, targetPath); err != nil {
		return fmt.Errorf("copy new binary: %w", err)
	}
	if err := os.Chmod(targetPath, 0755); err != nil {
		return fmt.Errorf("chmod binary: %w", err)
	}

	return nil
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0755)
}
```

- [ ] **Step 3: Commit**

```bash
git add agent/lifecycle/upgrade.go agent/api/client.go
git commit -m "feat: agent lifecycle upgrade module"
```

---

### Task 11: Agent SSE Event Handlers

**Files:**
- Modify: `agent/agent/agent.go:87-102`

- [ ] **Step 1: Add new SSE event cases and helper methods**

Update `handleSSEEvent` in `agent/agent/agent.go`:

```go
func (a *Agent) handleSSEEvent(evt api.SSEEvent) {
	log.Printf("[agent] SSE event: %s", evt.Event)
	switch evt.Event {
	case "connected":
		log.Println("[agent] SSE connected to management platform")
		if err := a.pullAndApplyConfigForce(true); err != nil {
			log.Printf("[agent] Config pull on reconnect failed: %v", err)
		}
	case "peer_update", "config_update", "tunnel_update":
		if err := a.pullAndApplyConfig(); err != nil {
			log.Printf("[agent] Config apply failed: %v", err)
			a.client.ReportError("Config apply failed: " + err.Error())
		}
	case "node_delete":
		log.Println("[agent] Received node_delete event, starting uninstall...")
		if err := lifecycle.RunUninstall(a.client); err != nil {
			log.Printf("[agent] Uninstall failed: %v", err)
			a.client.ReportError("Uninstall failed: " + err.Error())
		}
	case "upgrade":
		a.handleUpgrade()
	case "xray_upgrade":
		a.handleXrayUpgrade()
	}
}
```

Add the import for lifecycle:

```go
import (
	// ... existing imports ...
	"github.com/wiremesh/agent/lifecycle"
)
```

- [ ] **Step 2: Add upgrade handler methods**

Add to `agent/agent/agent.go`:

```go
func (a *Agent) handleUpgrade() {
	log.Println("[agent] Received upgrade event, starting agent upgrade...")
	// Report upgrading status
	report := &api.StatusReport{IsOnline: true, AgentVersion: a.version}
	report.Transfers = nil // lightweight status for upgrade notification
	a.client.ReportStatus(report)

	needRestart, err := lifecycle.UpgradeAgent(a.client, a.version)
	if err != nil {
		log.Printf("[agent] Agent upgrade failed: %v", err)
		a.client.ReportError("Agent upgrade failed: " + err.Error())
		return
	}
	if needRestart {
		log.Println("[agent] Agent upgrade complete, triggering graceful restart...")
		a.Stop() // triggers shutdown() -> process exit -> systemd restart
	}
}

func (a *Agent) handleXrayUpgrade() {
	log.Println("[agent] Received xray_upgrade event, starting Xray upgrade...")
	if err := lifecycle.UpgradeXray(a.client); err != nil {
		log.Printf("[agent] Xray upgrade failed: %v", err)
		a.client.ReportError("Xray upgrade failed: " + err.Error())
	}
}
```

- [ ] **Step 3: Add pending_delete check in pullAndApplyConfigForce**

In the `pullAndApplyConfigForce` method, after fetching config and before applying, check for pending_delete:

```go
func (a *Agent) pullAndApplyConfigForce(force bool) error {
	cfgData, err := a.client.FetchConfig()
	if err != nil {
		return err
	}

	// Check if node is pending deletion
	if cfgData.PendingDelete {
		log.Println("[agent] Node is pending deletion, starting uninstall...")
		if err := lifecycle.RunUninstall(a.client); err != nil {
			return fmt.Errorf("uninstall on pending delete: %w", err)
		}
		return nil
	}

	if !force && cfgData.Version == a.lastVersion && a.lastVersion != "" {
		log.Println("[agent] Config version unchanged, skipping")
		return nil
	}
	// ... rest of method unchanged ...
```

- [ ] **Step 4: Commit**

```bash
git add agent/agent/agent.go
git commit -m "feat: handle node_delete, upgrade, xray_upgrade SSE events"
```

---

### Task 12: Server — Node Deletion with Remote Uninstall

**Files:**
- Modify: `src/app/api/nodes/[id]/route.ts:168-190`
- Modify: `src/app/api/agent/sse/route.ts:21-34`

- [ ] **Step 1: Update DELETE handler to send SSE and mark pendingDelete**

Replace the DELETE handler in `src/app/api/nodes/[id]/route.ts`:

```typescript
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const existing = db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.node");

  // Mark as pending delete (keep record for agent to pull config and see pending_delete)
  db.update(nodes)
    .set({ pendingDelete: true, updatedAt: new Date().toISOString() })
    .where(eq(nodes.id, nodeId))
    .run();

  // Try to notify agent via SSE
  const sent = sseManager.sendEvent(nodeId, "node_delete");

  writeAuditLog({
    action: "delete",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

  if (sent) {
    // Agent is online — schedule DB cleanup after SSE disconnect
    // The SSE cancel handler will detect pendingDelete and clean up
    return success({ message: "nodes.deleteRemoteUninstall" });
  } else {
    // Agent is offline — will be cleaned up when it reconnects (or by worker after 7 days)
    return success({ message: "nodes.deleteOfflinePending" });
  }
}
```

Make sure `sseManager` is imported at the top of the file (add if not already there):

```typescript
import { sseManager } from "@/lib/sse-manager";
```

- [ ] **Step 2: Update SSE endpoint to clean up pendingDelete nodes**

In `src/app/api/agent/sse/route.ts`, update the `cancel()` handler to delete pendingDelete nodes:

```typescript
    cancel() {
      sseManager.removeConnection(nodeId);

      try {
        // Check if node is pending delete — if so, remove the record
        const current = db
          .select({ pendingDelete: nodes.pendingDelete })
          .from(nodes)
          .where(eq(nodes.id, nodeId))
          .get();

        if (current?.pendingDelete) {
          // Delay deletion to allow uninstall script to finish
          setTimeout(() => {
            db.delete(nodes).where(eq(nodes.id, nodeId)).run();
          }, 30000);
        } else {
          // Normal offline marking
          db.update(nodes)
            .set({ status: "offline", updatedAt: new Date().toISOString() })
            .where(eq(nodes.id, nodeId))
            .run();
        }
      } catch {
        // ignore
      }
    },
```

- [ ] **Step 3: Also check pendingDelete on SSE connection (for reconnecting nodes)**

In the `start(controller)` handler of the SSE endpoint, after sending the "connected" event, check pendingDelete:

```typescript
    start(controller) {
      sseManager.addConnection(nodeId, controller);

      // Check if this node is pending deletion
      const current = db
        .select({ pendingDelete: nodes.pendingDelete })
        .from(nodes)
        .where(eq(nodes.id, nodeId))
        .get();

      if (current?.pendingDelete) {
        // Node reconnected while pending delete — send delete event immediately
        const deleteMsg = `event: node_delete\ndata: {}\n\n`;
        controller.enqueue(new TextEncoder().encode(deleteMsg));
        return;
      }

      // Mark node online
      db.update(nodes)
        .set({ status: "online", errorMessage: null, updatedAt: new Date().toISOString() })
        .where(eq(nodes.id, nodeId))
        .run();

      // Send connected event
      const message = `event: connected\ndata: ${JSON.stringify({ nodeId })}\n\n`;
      controller.enqueue(new TextEncoder().encode(message));
    },
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/nodes/[id]/route.ts src/app/api/agent/sse/route.ts
git commit -m "feat: node deletion triggers remote uninstall via SSE"
```

---

### Task 13: Upgrade Trigger API Endpoints

**Files:**
- Create: `src/app/api/nodes/[id]/upgrade/route.ts`
- Create: `src/app/api/nodes/[id]/xray-upgrade/route.ts`
- Create: `src/app/api/nodes/batch-upgrade/route.ts`

- [ ] **Step 1: Create single node upgrade endpoint**

Create `src/app/api/nodes/[id]/upgrade/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { success, error } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const node = db.select({ id: nodes.id, name: nodes.name }).from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "notFound.node");

  const sent = sseManager.sendEvent(nodeId, "upgrade", {});
  if (!sent) {
    return error("CONFLICT", "nodes.upgradeOffline");
  }

  db.update(nodes)
    .set({ status: "upgrading", updatedAt: new Date().toISOString() })
    .where(eq(nodes.id, nodeId))
    .run();

  return success({ message: "nodes.upgradeTriggered" });
}
```

- [ ] **Step 2: Create single node Xray upgrade endpoint**

Create `src/app/api/nodes/[id]/xray-upgrade/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { success, error } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const node = db.select({ id: nodes.id, name: nodes.name }).from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "notFound.node");

  const sent = sseManager.sendEvent(nodeId, "xray_upgrade", {});
  if (!sent) {
    return error("CONFLICT", "nodes.upgradeOffline");
  }

  return success({ message: "nodes.xrayUpgradeTriggered" });
}
```

- [ ] **Step 3: Create batch upgrade endpoint**

Create `src/app/api/nodes/batch-upgrade/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { success, error } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  const body = await request.json() as { nodeIds: number[]; type: "agent" | "xray" };
  const { nodeIds, type } = body;

  if (!nodeIds?.length) return error("VALIDATION_ERROR", "validation.nodeIdsRequired");

  const event = type === "xray" ? "xray_upgrade" : "upgrade";
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 3000;

  let sent = 0;
  let offline = 0;

  for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
    const batch = nodeIds.slice(i, i + BATCH_SIZE);
    for (const nodeId of batch) {
      if (sseManager.sendEvent(nodeId, event, {})) {
        if (type === "agent") {
          db.update(nodes)
            .set({ status: "upgrading", updatedAt: new Date().toISOString() })
            .where(eq(nodes.id, nodeId))
            .run();
        }
        sent++;
      } else {
        offline++;
      }
    }
    // Delay between batches (except last)
    if (i + BATCH_SIZE < nodeIds.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return success({ sent, offline, total: nodeIds.length });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/nodes/[id]/upgrade/route.ts src/app/api/nodes/[id]/xray-upgrade/route.ts src/app/api/nodes/batch-upgrade/route.ts
git commit -m "feat: add upgrade trigger API endpoints"
```

---

### Task 14: Install Script Enhancements

**Files:**
- Modify: `src/app/api/nodes/[id]/script/route.ts`

- [ ] **Step 1: Read the full install script to understand exact line references**

Read `src/app/api/nodes/[id]/script/route.ts` completely.

- [ ] **Step 2: Add logging at script start**

In the generated script, after `set -e` and color definitions, add:

```bash
# Log output
exec > >(tee -a /var/log/wiremesh-install.log) 2>&1
echo "=== WireMesh install started at $(date) ==="
```

- [ ] **Step 3: Add download retry logic**

Replace single `curl` calls for agent and xray binary downloads with a retry function. Add this function near the top of the generated script:

```bash
download_with_retry() {
  local url="$1" output="$2" max_retries=3 retry=0
  while [ $retry -lt $max_retries ]; do
    if curl -fsSL "$url" -o "$output" && [ -s "$output" ]; then
      return 0
    fi
    retry=$((retry + 1))
    warn "Download failed (attempt $retry/$max_retries), retrying in 5s..."
    sleep 5
  done
  return 1
}
```

Replace agent binary download curl call with:

```bash
if ! download_with_retry "${serverUrl}/api/agent/binary?arch=$AGENT_ARCH" /tmp/agent.tar.gz; then
  fail "Failed to download agent binary after 3 attempts"
fi
```

Same for xray binary download.

- [ ] **Step 4: Add checksum verification**

After each successful download, add checksum verification:

```bash
# Verify agent checksum
EXPECTED_CHECKSUM=$(curl -fsSL -I "${serverUrl}/api/agent/binary?arch=$AGENT_ARCH" 2>/dev/null | grep -i 'X-Agent-Checksum' | awk '{print $2}' | tr -d '\\r' | sed 's/sha256://')
if [ -n "$EXPECTED_CHECKSUM" ]; then
  ACTUAL_CHECKSUM=$(sha256sum /tmp/agent.tar.gz | awk '{print $1}')
  if [ "$EXPECTED_CHECKSUM" != "$ACTUAL_CHECKSUM" ]; then
    fail "Agent binary checksum mismatch (expected: $EXPECTED_CHECKSUM, got: $ACTUAL_CHECKSUM)"
  fi
  ok "Agent binary checksum verified"
fi
```

- [ ] **Step 5: Add upgrade backup logic**

In the upgrade flow (where `UPGRADE=true`), before replacing the agent binary:

```bash
if [ "$UPGRADE" = true ] && [ -f /usr/local/bin/wiremesh-agent ]; then
  cp /usr/local/bin/wiremesh-agent /usr/local/bin/wiremesh-agent.backup
  ok "Backed up current agent binary"
fi
```

- [ ] **Step 6: Add health check after agent start**

After `systemctl start wiremesh-agent`, add:

```bash
# Health check
info "Waiting for agent to start..."
HEALTH_OK=false
for i in $(seq 1 10); do
  sleep 3
  if systemctl is-active --quiet wiremesh-agent; then
    HEALTH_OK=true
  else
    HEALTH_OK=false
    break
  fi
  # Need 3 consecutive checks (9 seconds) to consider healthy
  if [ $i -ge 3 ] && [ "$HEALTH_OK" = true ]; then
    break
  fi
done

if [ "$HEALTH_OK" = true ]; then
  ok "Agent is running and healthy"
else
  warn "Agent may not be running properly. Check with: journalctl -u wiremesh-agent --no-pager -n 20"
  journalctl -u wiremesh-agent --no-pager -n 20 2>/dev/null || true
fi
```

- [ ] **Step 7: Update Xray install to check version and update if outdated**

Replace the existing "skip if exists" check for Xray with version comparison:

```bash
XRAY_NEEDS_INSTALL=true
if [ -f /usr/local/bin/wiremesh-xray ]; then
  CURRENT_XRAY_VERSION=$(/usr/local/bin/wiremesh-xray version 2>/dev/null | head -1 | awk '{print $2}' || echo "unknown")
  LATEST_XRAY_VERSION=$(curl -fsSL -I "${serverUrl}/api/agent/xray?arch=$AGENT_ARCH" 2>/dev/null | grep -i 'X-Xray-Version' | awk '{print $2}' | tr -d '\\r' || echo "unknown")
  if [ "$CURRENT_XRAY_VERSION" = "$LATEST_XRAY_VERSION" ] && [ "$CURRENT_XRAY_VERSION" != "unknown" ]; then
    ok "Xray already at latest version ($CURRENT_XRAY_VERSION)"
    XRAY_NEEDS_INSTALL=false
  else
    info "Xray version outdated ($CURRENT_XRAY_VERSION -> $LATEST_XRAY_VERSION), updating..."
    cp /usr/local/bin/wiremesh-xray /usr/local/bin/wiremesh-xray.backup 2>/dev/null || true
  fi
fi

if [ "$XRAY_NEEDS_INSTALL" = true ]; then
  info "Installing Xray..."
  if download_with_retry "${serverUrl}/api/agent/xray?arch=\$AGENT_ARCH" /tmp/xray.tar.gz; then
    tar -xzf /tmp/xray.tar.gz -C /tmp/
    mv /tmp/xray /usr/local/bin/wiremesh-xray 2>/dev/null || cp /tmp/xray /usr/local/bin/wiremesh-xray
    chmod +x /usr/local/bin/wiremesh-xray
    rm -f /tmp/xray.tar.gz /tmp/xray
    if [ -f /usr/local/bin/wiremesh-xray ]; then
      ok "Xray installed as wiremesh-xray"
    else
      warn "Xray installation failed (non-fatal)"
    fi
  else
    warn "Xray download failed after 3 attempts (non-fatal)"
  fi
fi
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/nodes/[id]/script/route.ts
git commit -m "feat: enhance install script with retry, checksum, health check, logging"
```

---

### Task 15: Worker — PendingDelete Cleanup

**Files:**
- Create: `worker/pending-delete-cleaner.js`
- Modify: `worker/index.js`

- [ ] **Step 1: Create pending-delete-cleaner.js**

```javascript
"use strict";

const Database = require("better-sqlite3");
const path = require("path");

function getDb() {
  const dbPath =
    (process.env.DATABASE_URL || "").replace("file:", "") ||
    path.join(process.cwd(), "data", "wiremesh.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function cleanPendingDeletes() {
  let db;
  try {
    db = getDb();

    // Delete nodes marked as pendingDelete for more than 7 days
    const result = db
      .prepare(
        "DELETE FROM nodes WHERE pending_delete = 1 AND updated_at < datetime('now', '-7 days')"
      )
      .run();

    if (result.changes > 0) {
      console.log(`[pending-delete-cleaner] Deleted ${result.changes} stale pending-delete nodes`);
    }
  } catch (err) {
    console.error("[pending-delete-cleaner] Error:", err);
  } finally {
    if (db) db.close();
  }
}

module.exports = { cleanPendingDeletes };
```

- [ ] **Step 2: Register in worker/index.js**

Add to imports:

```javascript
const { cleanPendingDeletes } = require("./pending-delete-cleaner");
```

Add to `runClean()`:

```javascript
function runClean() {
  console.log("[worker] Running data cleanup...");
  cleanData();
  cleanPendingDeletes();
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/pending-delete-cleaner.js worker/index.js
git commit -m "feat: worker cleans up stale pending-delete nodes after 7 days"
```

---

### Task 16: Node List API — Include Version Fields

**Files:**
- Modify: `src/app/api/nodes/route.ts`

- [ ] **Step 1: Add version fields to the GET query select**

In the `.select()` call of the nodes list query, add `agentVersion` and `xrayVersion`:

```typescript
      agentVersion: nodes.agentVersion,
      xrayVersion: nodes.xrayVersion,
```

This ensures the API response includes version info for the frontend to display.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "feat: include agent/xray version in nodes list API response"
```

---

### Task 17: UI — Version Columns, Upgrade Buttons, Delete Dialog

**Files:**
- Modify: `src/app/(dashboard)/nodes/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: Add i18n keys**

Add to the `nodes` section in `messages/en.json`:

```json
    "agentVersion": "Agent Version",
    "xrayVersion": "Xray Version",
    "versionUnknown": "Unknown",
    "upgradable": "Upgradable",
    "upgrade": "Upgrade",
    "upgradeAll": "Upgrade All",
    "upgradeAgent": "Upgrade Agent",
    "upgradeXray": "Upgrade Xray",
    "upgradeTriggered": "Upgrade triggered",
    "upgradeOffline": "Node is offline, cannot upgrade",
    "upgradeFailed": "Upgrade trigger failed",
    "confirmDeleteNode": "This will remotely uninstall all WireMesh components on the node. Are you sure?",
    "deleteOfflinePending": "Node is offline. It will be uninstalled when it comes back online.",
    "manualUninstall": "Manual uninstall command",
    "status.upgrading": "Upgrading"
```

Add corresponding Chinese translations in `messages/zh-CN.json`:

```json
    "agentVersion": "Agent 版本",
    "xrayVersion": "Xray 版本",
    "versionUnknown": "未知",
    "upgradable": "可升级",
    "upgrade": "升级",
    "upgradeAll": "全部升级",
    "upgradeAgent": "升级 Agent",
    "upgradeXray": "升级 Xray",
    "upgradeTriggered": "升级已触发",
    "upgradeOffline": "节点离线，无法升级",
    "upgradeFailed": "升级触发失败",
    "confirmDeleteNode": "此操作将远程卸载节点上的所有 WireMesh 组件，确认删除？",
    "deleteOfflinePending": "节点当前离线，将在下次上线时自动卸载。",
    "manualUninstall": "手动卸载命令",
    "status.upgrading": "升级中"
```

- [ ] **Step 2: Update Node type in page.tsx**

Add version fields to the Node type:

```typescript
type Node = {
  id: number;
  name: string;
  ip: string;
  wgAddress: string;
  status: string;
  agentVersion: string | null;
  xrayVersion: string | null;
  ports: {
    wg: number;
    xray: number[];
    tunnels: number[];
    socks5: number[];
  };
};
```

- [ ] **Step 3: Add version columns to the columns array**

Insert after the `status` column and before the `ports` column:

```typescript
    {
      key: "agentVersion",
      label: t("agentVersion"),
      render: (row) => {
        const node = row as unknown as Node;
        return (
          <span className="text-sm font-mono">
            {node.agentVersion || t("versionUnknown")}
          </span>
        );
      },
    },
    {
      key: "xrayVersion",
      label: t("xrayVersion"),
      render: (row) => {
        const node = row as unknown as Node;
        return (
          <span className="text-sm font-mono">
            {node.xrayVersion || t("versionUnknown")}
          </span>
        );
      },
    },
```

- [ ] **Step 4: Add upgrade button to actions column**

In the actions column render, add an upgrade button before the edit button:

```typescript
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const res = await fetch(`/api/nodes/${row.id}/upgrade`, { method: "POST" });
                if (res.ok) {
                  toast.success(t("upgradeTriggered"));
                  fetchNodes(pagination.page);
                } else {
                  const json = await res.json();
                  toast.error(translateError(json.error, te, t("upgradeFailed")));
                }
              } catch {
                toast.error(t("upgradeFailed"));
              }
            }}
            disabled={(row as unknown as Node).status !== "online"}
          >
            {t("upgrade")}
          </Button>
```

- [ ] **Step 5: Add batch upgrade button**

In the batch action bar (where `selectedIds.size > 0`), add an upgrade button alongside the existing batch delete button:

```typescript
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
          <span className="text-sm font-medium">{tc("selectedItems", { count: selectedIds.size })}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch("/api/nodes/batch-upgrade", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ nodeIds: [...selectedIds], type: "agent" }),
                });
                const json = await res.json();
                if (res.ok) {
                  toast.success(t("upgradeTriggered") + ` (${json.data.sent}/${json.data.total})`);
                  fetchNodes(pagination.page);
                } else {
                  toast.error(translateError(json.error, te, t("upgradeFailed")));
                }
              } catch {
                toast.error(t("upgradeFailed"));
              }
            }}
          >
            {t("upgradeAll")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
            {tc("batchDelete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            {tc("cancelSelection")}
          </Button>
        </div>
      )}
```

- [ ] **Step 6: Update delete confirmation dialog text**

Replace the existing delete dialog body text:

```typescript
          <p className="text-muted-foreground">{t("confirmDeleteNode")}</p>
```

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/nodes/page.tsx messages/en.json messages/zh-CN.json
git commit -m "feat: UI — version columns, upgrade button, improved delete dialog"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Build check**

Run: `npm run build`
Expected: No TypeScript errors, build succeeds.

- [ ] **Step 2: Agent build check**

Run: `cd agent && go build -ldflags "-X main.Version=test" -o /dev/null . && echo "OK"`
Expected: `OK`

- [ ] **Step 3: Docker build check**

Run: `docker build --build-arg AGENT_VERSION=v1.0.0-test -t wiremesh-test .`
Expected: Build succeeds, checksum files generated.

- [ ] **Step 4: Verify binary headers**

Start the container and test:
```bash
curl -sI "http://localhost:3000/api/agent/binary?arch=amd64" | grep -E "X-Agent"
```
Expected: `X-Agent-Version` and `X-Agent-Checksum` headers present.

- [ ] **Step 5: Final commit if any fixes needed**

Fix any issues found during verification and commit.
