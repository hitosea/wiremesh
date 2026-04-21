# Traffic & Connection Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-device traffic (WG + Xray), per-device connection count ("在线 x N"), per-device active source IPs (Xray only), and per-node forward-tunnel traffic. Surface all of this in device list, device detail, node detail, and dashboard.

**Architecture:** Agent calls Xray stats API (`statsquery -pattern "user>>>"` for traffic, `statsonlineiplist -email <uuid>` per-user for IPs) and reads `wg show wm-tun* transfer` on all nodes (exit/relay/dual-role). Platform accumulates traffic deltas keyed by `xrayUuid`, stores connection count + active IP JSON on devices, stores forward-bytes columns on node_status. UI reads and displays.

**Tech Stack:** Go (agent), Next.js 15 + TypeScript (platform), Drizzle ORM + SQLite, Recharts (charts), next-intl (i18n).

---

## File Structure

**New files**
- `drizzle/0009_traffic_and_connection_stats.sql` — schema migration
- `src/lib/format-bytes.ts` — shared byte formatter (extracted from `node-status-chart.tsx`)
- `src/components/status-dot-with-count.tsx` — wrapper that appends "x N" when count ≥ 2

**Modified files**

Agent (Go):
- `agent/xray/config.go` — enable `statsUserUplink` / `statsUserDownlink`
- `agent/api/status.go` — new report fields
- `agent/collector/collector.go` — `collectXrayTransfers`, `collectXrayConnections`, `collectForwardTransfers`
- `agent/collector/collector_test.go` — unit tests for new parsers

Platform:
- `src/lib/db/schema.ts` — add columns
- `src/app/api/agent/status/route.ts` — persist new fields
- `src/app/api/devices/route.ts` — include new fields in list response
- `src/app/api/devices/[id]/route.ts` — include new fields in detail response
- `src/app/api/dashboard/route.ts` — include forward traffic in node-traffic aggregation
- `src/components/node-status-chart.tsx` — add forward series
- `src/app/(dashboard)/devices/page.tsx` — traffic column + status renderer
- `src/app/(dashboard)/devices/[id]/page.tsx` — traffic card + active-IPs card
- `src/app/(dashboard)/dashboard/page.tsx` — device status renderer + forward columns
- `messages/zh-CN.json`, `messages/en.json` — new keys

---

## Task 1: Schema migration

**Files:**
- Create: `drizzle/0009_traffic_and_connection_stats.sql`
- Modify: `src/lib/db/schema.ts:62-70` (nodeStatus), `src/lib/db/schema.ts:121-139` (devices)

- [ ] **Step 1: Write migration SQL**

Create `drizzle/0009_traffic_and_connection_stats.sql`:

```sql
ALTER TABLE `node_status` ADD `forward_upload_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `node_status` ADD `forward_download_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `connection_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `active_ips` text;
```

- [ ] **Step 2: Update Drizzle schema**

In `src/lib/db/schema.ts`, modify `nodeStatus` table to add:

```typescript
  forwardUploadBytes: integer("forward_upload_bytes").notNull().default(0),
  forwardDownloadBytes: integer("forward_download_bytes").notNull().default(0),
```

Modify `devices` table to add (after `downloadBytes` line):

```typescript
  connectionCount: integer("connection_count").notNull().default(0),
  activeIps: text("active_ips"),
```

- [ ] **Step 3: Update journal**

Update `drizzle/meta/_journal.json` to include entry for `0009_traffic_and_connection_stats`. Pattern (copy tag/when style from existing entries):

```json
{
  "idx": 9,
  "version": "7",
  "when": <current-unix-ms>,
  "tag": "0009_traffic_and_connection_stats",
  "breakpoints": true
}
```

Also copy `drizzle/meta/0008_snapshot.json` to `drizzle/meta/0009_snapshot.json` and manually update it: bump `id`, add the three new columns to `devices` and two new columns to `node_status`. If the snapshot diff proves tedious, delete `data/wiremesh.db*` then run `npx drizzle-kit generate` to regenerate — but this loses local data. **For a live deployment, prefer the hand-edit.**

- [ ] **Step 4: Apply migration locally and verify**

Run:
```bash
rm -f data/wiremesh.db*
# dev server picks up schema on next boot via migrate-on-start
# OR: manually apply
sqlite3 data/wiremesh.db < drizzle/0009_traffic_and_connection_stats.sql
```

Restart dev server. Verify new columns exist:
```bash
sqlite3 data/wiremesh.db 'PRAGMA table_info(devices);' | grep -E 'connection_count|active_ips'
sqlite3 data/wiremesh.db 'PRAGMA table_info(node_status);' | grep forward_
```

Expected: 4 new rows.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0009_traffic_and_connection_stats.sql drizzle/meta/ src/lib/db/schema.ts
git commit -m "feat(db): add traffic and connection stats columns"
```

---

## Task 2: Agent — enable Xray per-user traffic policy

**Files:**
- Modify: `agent/xray/config.go:157-163`

- [ ] **Step 1: Add two policy fields**

In `agent/xray/config.go`, find the `policy` block and modify:

```go
"policy": map[string]interface{}{
    "levels": map[string]interface{}{
        "0": map[string]interface{}{
            "statsUserOnline":   true,
            "statsUserUplink":   true,
            "statsUserDownlink": true,
        },
    },
},
```

- [ ] **Step 2: Update config_test.go expectations**

In `agent/xray/config_test.go`, find the test that asserts policy content (search for `statsUserOnline`). Extend any existing assertion to also verify `statsUserUplink` and `statsUserDownlink` equal `true`. If no such assertion exists, add:

```go
policy := cfg["policy"].(map[string]interface{})
levels := policy["levels"].(map[string]interface{})
level0 := levels["0"].(map[string]interface{})
for _, key := range []string{"statsUserOnline", "statsUserUplink", "statsUserDownlink"} {
    if level0[key] != true {
        t.Errorf("policy.levels.0.%s = %v, want true", key, level0[key])
    }
}
```

- [ ] **Step 3: Run xray package tests**

Run: `cd agent && go test ./xray/...`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add agent/xray/config.go agent/xray/config_test.go
git commit -m "feat(agent): enable Xray per-user uplink/downlink stats"
```

---

## Task 3: Agent — extend StatusReport with new fields

**Files:**
- Modify: `agent/api/status.go`

- [ ] **Step 1: Add new report types**

Replace the entire content of `agent/api/status.go` with:

```go
package api

type StatusReport struct {
	IsOnline         bool                   `json:"is_online"`
	Latency          *int                   `json:"latency,omitempty"`
	Transfers        []TransferReport       `json:"transfers,omitempty"`
	Handshakes       []HandshakeReport      `json:"handshakes,omitempty"`
	XrayOnlineUsers  []string               `json:"xray_online_users,omitempty"`
	XrayTransfers    []XrayTransferReport   `json:"xray_transfers,omitempty"`
	XrayConnections  []XrayConnectionReport `json:"xray_connections,omitempty"`
	ForwardUpload    int64                  `json:"forward_upload,omitempty"`
	ForwardDownload  int64                  `json:"forward_download,omitempty"`
	AgentVersion     string                 `json:"agent_version,omitempty"`
	XrayVersion      string                 `json:"xray_version,omitempty"`
	XrayRunning      bool                   `json:"xray_running"`
}

type TransferReport struct {
	PeerPublicKey string `json:"peer_public_key"`
	UploadBytes   int64  `json:"upload_bytes"`
	DownloadBytes int64  `json:"download_bytes"`
}

type HandshakeReport struct {
	PeerPublicKey string `json:"peer_public_key"`
	LastHandshake string `json:"last_handshake"` // ISO 8601
}

// XrayTransferReport: per-user traffic delta since last report.
type XrayTransferReport struct {
	Uuid          string `json:"uuid"`
	UploadBytes   int64  `json:"upload_bytes"`
	DownloadBytes int64  `json:"download_bytes"`
}

// XrayConnectionReport: active source IPs for a user, with last_seen unix ts.
type XrayConnectionReport struct {
	Uuid string          `json:"uuid"`
	Ips  []XrayActiveIp  `json:"ips"`
}

type XrayActiveIp struct {
	Ip       string `json:"ip"`
	LastSeen int64  `json:"last_seen"`
}

type ErrorReport struct {
	Message string `json:"message"`
}
```

- [ ] **Step 2: Build to verify struct valid**

Run: `cd agent && go build ./...`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add agent/api/status.go
git commit -m "feat(agent): extend StatusReport with xray traffic/connections and forward bytes"
```

---

## Task 4: Agent — collect Xray per-user traffic (delta-based)

**Files:**
- Modify: `agent/collector/collector.go`
- Modify: `agent/collector/collector_test.go`

- [ ] **Step 1: Write the failing test**

Append to `agent/collector/collector_test.go`:

```go
func TestParseXrayTransfers(t *testing.T) {
	input := `{"stat":[
		{"name":"user>>>aaa>>>traffic>>>uplink","value":1000},
		{"name":"user>>>aaa>>>traffic>>>downlink","value":5000},
		{"name":"user>>>bbb>>>traffic>>>uplink","value":200},
		{"name":"user>>>bbb>>>traffic>>>downlink","value":300}
	]}`
	got := parseXrayTransfers(input)
	if len(got) != 2 {
		t.Fatalf("expected 2 users, got %d", len(got))
	}
	byUuid := map[string][2]int64{}
	for u, v := range got {
		byUuid[u] = [2]int64{v.uplink, v.downlink}
	}
	if byUuid["aaa"] != [2]int64{1000, 5000} {
		t.Errorf("aaa got %v", byUuid["aaa"])
	}
	if byUuid["bbb"] != [2]int64{200, 300} {
		t.Errorf("bbb got %v", byUuid["bbb"])
	}
}

func TestParseXrayOnlineIpList(t *testing.T) {
	input := `{"ips":{"1.2.3.4":1776727876,"5.6.7.8":1776727877},"name":"user>>>xxx>>>online"}`
	got := parseXrayOnlineIpList(input)
	if len(got) != 2 {
		t.Fatalf("expected 2 ips, got %d", len(got))
	}
	m := map[string]int64{}
	for _, ip := range got {
		m[ip.Ip] = ip.LastSeen
	}
	if m["1.2.3.4"] != 1776727876 || m["5.6.7.8"] != 1776727877 {
		t.Errorf("parsed wrong: %v", got)
	}
}

func TestParseXrayOnlineIpListEmpty(t *testing.T) {
	if got := parseXrayOnlineIpList(`{"name":"user>>>x>>>online"}`); len(got) != 0 {
		t.Errorf("expected empty, got %v", got)
	}
}
```

- [ ] **Step 2: Run — it should fail (functions don't exist)**

Run: `cd agent && go test ./collector/...`
Expected: FAIL with `undefined: parseXrayTransfers` and `undefined: parseXrayOnlineIpList`.

- [ ] **Step 3: Add parsing functions and delta state**

In `agent/collector/collector.go`, add AFTER the existing `previousUpload/previousDownload/prevMu` block (around line 24):

```go
var (
	previousXrayUpload   = make(map[string]int64)
	previousXrayDownload = make(map[string]int64)
	xrayMu               sync.Mutex
)
```

Then at the end of the file (after the existing functions), add:

```go
type xrayUserTraffic struct {
	uplink   int64
	downlink int64
}

// parseXrayTransfers turns `xray api statsquery -pattern "user>>>"` output
// into a uuid -> (uplink, downlink) map of cumulative byte counters.
// Stat keys look like "user>>>uuid>>>traffic>>>uplink" or ">>>downlink".
func parseXrayTransfers(output string) map[string]xrayUserTraffic {
	var result struct {
		Stat []struct {
			Name  string `json:"name"`
			Value int64  `json:"value"`
		} `json:"stat"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	out := make(map[string]xrayUserTraffic)
	for _, s := range result.Stat {
		parts := strings.Split(s.Name, ">>>")
		if len(parts) != 4 || parts[0] != "user" || parts[2] != "traffic" {
			continue
		}
		uuid := parts[1]
		entry := out[uuid]
		switch parts[3] {
		case "uplink":
			entry.uplink = s.Value
		case "downlink":
			entry.downlink = s.Value
		}
		out[uuid] = entry
	}
	return out
}

func parseXrayOnlineIpList(output string) []api.XrayActiveIp {
	var result struct {
		Ips map[string]int64 `json:"ips"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	ips := make([]api.XrayActiveIp, 0, len(result.Ips))
	for ip, lastSeen := range result.Ips {
		ips = append(ips, api.XrayActiveIp{Ip: ip, LastSeen: lastSeen})
	}
	return ips
}

func collectXrayTransfers() []api.XrayTransferReport {
	cmd := exec.Command(xray.XrayBinary, "api", "statsquery",
		"-pattern", "user>>>", "-s",
		fmt.Sprintf("127.0.0.1:%d", xray.XrayAPIPort))
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	current := parseXrayTransfers(string(out))
	if len(current) == 0 {
		return nil
	}

	xrayMu.Lock()
	defer xrayMu.Unlock()

	var reports []api.XrayTransferReport
	for uuid, v := range current {
		prevUp := previousXrayUpload[uuid]
		prevDown := previousXrayDownload[uuid]
		deltaUp := v.uplink - prevUp
		deltaDown := v.downlink - prevDown
		if deltaUp < 0 {
			deltaUp = v.uplink
		}
		if deltaDown < 0 {
			deltaDown = v.downlink
		}
		previousXrayUpload[uuid] = v.uplink
		previousXrayDownload[uuid] = v.downlink
		if deltaUp > 0 || deltaDown > 0 {
			reports = append(reports, api.XrayTransferReport{
				Uuid:          uuid,
				UploadBytes:   deltaUp,
				DownloadBytes: deltaDown,
			})
		}
	}
	return reports
}

func collectXrayConnections(onlineUuids []string) []api.XrayConnectionReport {
	if len(onlineUuids) == 0 {
		return nil
	}
	reports := make([]api.XrayConnectionReport, 0, len(onlineUuids))
	for _, uuid := range onlineUuids {
		cmd := exec.Command(xray.XrayBinary, "api", "statsonlineiplist",
			"-email", uuid, "-s",
			fmt.Sprintf("127.0.0.1:%d", xray.XrayAPIPort))
		out, err := cmd.Output()
		if err != nil {
			continue
		}
		ips := parseXrayOnlineIpList(string(out))
		reports = append(reports, api.XrayConnectionReport{
			Uuid: uuid,
			Ips:  ips,
		})
	}
	return reports
}
```

- [ ] **Step 4: Run the new tests**

Run: `cd agent && go test ./collector/...`
Expected: all tests PASS (original ones plus three new).

- [ ] **Step 5: Commit**

```bash
git add agent/collector/collector.go agent/collector/collector_test.go
git commit -m "feat(agent): collect per-user Xray traffic deltas and online IPs"
```

---

## Task 5: Agent — collect forward-tunnel bytes per node

**Files:**
- Modify: `agent/collector/collector.go`
- Modify: `agent/wg/` (if helper needed — inspect first)

- [ ] **Step 1: Check available WG helpers**

Run: `grep -n 'func ' agent/wg/*.go | head -10`

You should see `WgShow(iface, query string)`. If it exists, reuse. If not, use `exec.Command("wg", "show", iface, "transfer")`.

- [ ] **Step 2: Add state for forward bytes**

In `agent/collector/collector.go`, after the `xrayMu` block added in Task 4, add:

```go
var (
	previousForwardUpload   = make(map[string]int64)
	previousForwardDownload = make(map[string]int64)
	forwardMu               sync.Mutex
)
```

- [ ] **Step 3: Implement collectForwardTransfers**

Append to `agent/collector/collector.go`:

```go
// collectForwardTransfers sums per-peer transfer across all wm-tun* interfaces
// on this node. This represents inter-node forward traffic (for exit/relay
// nodes this is the dominant contribution; for entry nodes it roughly equals
// the wm-wg0 traffic, but is counted separately so the UI can distinguish
// "client-side traffic" from "transit traffic").
//
// Returns (uploadDelta, downloadDelta) since last call.
func collectForwardTransfers() (int64, int64) {
	ifaces := listTunnelInterfaces()
	if len(ifaces) == 0 {
		return 0, 0
	}
	var totalUp, totalDown int64
	for _, iface := range ifaces {
		output, err := wg.WgShow(iface, "transfer")
		if err != nil {
			continue
		}
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := strings.Split(line, "\t")
			if len(parts) != 3 {
				continue
			}
			rx, _ := strconv.ParseInt(parts[1], 10, 64)
			tx, _ := strconv.ParseInt(parts[2], 10, 64)
			// Peer key is unique across tunnels; safe to key on it.
			key := iface + "\t" + parts[0]

			forwardMu.Lock()
			prevUp := previousForwardUpload[key]
			prevDown := previousForwardDownload[key]
			deltaUp := tx - prevUp
			deltaDown := rx - prevDown
			if deltaUp < 0 {
				deltaUp = tx
			}
			if deltaDown < 0 {
				deltaDown = rx
			}
			previousForwardUpload[key] = tx
			previousForwardDownload[key] = rx
			forwardMu.Unlock()

			totalUp += deltaUp
			totalDown += deltaDown
		}
	}
	return totalUp, totalDown
}

// listTunnelInterfaces returns all `wm-tun*` interface names currently up.
func listTunnelInterfaces() []string {
	out, err := exec.Command("ip", "-o", "link", "show").Output()
	if err != nil {
		return nil
	}
	var ifaces []string
	for _, line := range strings.Split(string(out), "\n") {
		// Lines look like: "6: wm-tun1: <POINTOPOINT,...>"
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSuffix(parts[1], ":")
		name = strings.TrimSuffix(name, "@NONE")
		if strings.HasPrefix(name, "wm-tun") {
			ifaces = append(ifaces, name)
		}
	}
	return ifaces
}
```

- [ ] **Step 4: Wire into Collect()**

Modify the `Collect()` function in `agent/collector/collector.go` (currently returns with only `Transfers/Handshakes/XrayOnlineUsers`) to also populate the new fields. Replace the `Collect()` body so it reads:

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
	report.XrayTransfers = collectXrayTransfers()
	report.XrayConnections = collectXrayConnections(report.XrayOnlineUsers)
	fwUp, fwDown := collectForwardTransfers()
	report.ForwardUpload = fwUp
	report.ForwardDownload = fwDown
	report.AgentVersion = agentVersion
	report.XrayVersion = xray.GetVersion()
	report.XrayRunning = xray.IsRunning()
	return report
}
```

- [ ] **Step 5: Build & test**

Run: `cd agent && go build ./... && go test ./...`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add agent/collector/collector.go
git commit -m "feat(agent): report forward-tunnel byte deltas from all wm-tun interfaces"
```

---

## Task 6: Build and deploy new agent

**Files:**
- Modify: `public/agent/wiremesh-agent-linux-{amd64,arm64}.tar.gz` (regenerated)

- [ ] **Step 1: Rebuild binaries**

Run from `agent/` directory:

```bash
cd agent
VERSION=$(grep '"version"' ../package.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')
for ARCH in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$ARCH go build \
    -ldflags "-X main.Version=$VERSION" -o wiremesh-agent .
  tar czf ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz wiremesh-agent
  sha256sum ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz \
    > ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz.sha256
  rm wiremesh-agent
done
echo -n "$VERSION" > ../public/agent/agent-version.txt
```

- [ ] **Step 2: Verify binary served**

Run: `curl -sI http://localhost:3456/api/agent/binary?arch=amd64 | grep -E "X-Agent-(Version|Checksum)"`
Expected: headers present, version matches.

- [ ] **Step 3: Push to both test nodes**

```bash
tar xzf public/agent/wiremesh-agent-linux-amd64.tar.gz -C /tmp/
for HOST in 8.138.87.1 47.84.76.136; do
  sshpass -p 'Ab123456..' scp -o StrictHostKeyChecking=no \
    /tmp/wiremesh-agent root@$HOST:/tmp/wiremesh-agent
  sshpass -p 'Ab123456..' ssh -o StrictHostKeyChecking=no root@$HOST \
    'systemctl stop wiremesh-agent && \
     mv /tmp/wiremesh-agent /usr/local/bin/wiremesh-agent && \
     chmod +x /usr/local/bin/wiremesh-agent && \
     systemctl start wiremesh-agent'
done
```

- [ ] **Step 4: No commit**

Agent artifacts are gitignored; no commit needed.

---

## Task 7: Platform — persist new fields in status handler

**Files:**
- Modify: `src/app/api/agent/status/route.ts`

- [ ] **Step 1: Update request body type**

In `src/app/api/agent/status/route.ts`, replace the body type declaration (around line 19-28) with:

```typescript
  const body = await request.json() as {
    is_online: boolean;
    latency?: number;
    transfers?: Transfer[];
    handshakes?: Handshake[];
    xray_online_users?: string[];
    xray_transfers?: { uuid: string; upload_bytes: number; download_bytes: number }[];
    xray_connections?: { uuid: string; ips: { ip: string; last_seen: number }[] }[];
    forward_upload?: number;
    forward_download?: number;
    agent_version?: string;
    xray_version?: string;
    xray_running?: boolean;
  };

  const {
    is_online,
    latency,
    transfers = [],
    handshakes = [],
    xray_online_users = [],
    xray_transfers = [],
    xray_connections = [],
    forward_upload = 0,
    forward_download = 0,
    agent_version,
    xray_version,
  } = body;
```

- [ ] **Step 2: Include forward bytes in node_status insert**

Find the `db.insert(nodeStatus)` call (around line 41) and add the two new fields:

```typescript
  db.insert(nodeStatus)
    .values({
      nodeId: node.id,
      isOnline: is_online,
      latency: latency ?? null,
      uploadBytes: totalUpload,
      downloadBytes: totalDownload,
      forwardUploadBytes: forward_upload,
      forwardDownloadBytes: forward_download,
    })
    .run();
```

- [ ] **Step 3: Add Xray traffic accumulation**

After the `// Update online status for Xray-protocol devices` block (around line 105), REPLACE with:

```typescript
  // Update online status + traffic + connection count for Xray devices
  const now = new Date().toISOString();

  // Accumulate Xray traffic deltas keyed by xrayUuid
  for (const xt of xray_transfers) {
    db.update(devices)
      .set({
        uploadBytes: sql`${devices.uploadBytes} + ${xt.upload_bytes}`,
        downloadBytes: sql`${devices.downloadBytes} + ${xt.download_bytes}`,
        updatedAt: now,
      })
      .where(eq(devices.xrayUuid, xt.uuid))
      .run();
  }

  // Build UUID -> connection info map
  const connInfoByUuid = new Map<string, { count: number; ips: string }>();
  for (const c of xray_connections) {
    connInfoByUuid.set(c.uuid, {
      count: c.ips.length,
      ips: JSON.stringify(c.ips),
    });
  }

  if (xray_online_users.length > 0) {
    for (const uuid of xray_online_users) {
      const conn = connInfoByUuid.get(uuid);
      const device = db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.xrayUuid, uuid))
        .get();
      if (!device) continue;
      db.update(devices)
        .set({
          lastHandshake: now,
          connectionCount: conn?.count ?? 1,
          activeIps: conn?.ips ?? null,
          updatedAt: now,
        })
        .where(eq(devices.id, device.id))
        .run();
      adminSseManager.broadcast("device_status", {
        deviceId: device.id,
        lastHandshake: now,
        connectionCount: conn?.count ?? 1,
      });
    }
  }

  // Zero out connection_count for previously-online Xray devices no longer reported
  const reportedSet = new Set(xray_online_users);
  const staleXrayDevices = db
    .select({ id: devices.id, xrayUuid: devices.xrayUuid })
    .from(devices)
    .where(and(eq(devices.protocol, "xray"), gt(devices.connectionCount, 0)))
    .all();
  for (const d of staleXrayDevices) {
    if (d.xrayUuid && !reportedSet.has(d.xrayUuid)) {
      db.update(devices)
        .set({ connectionCount: 0, activeIps: null, updatedAt: now })
        .where(eq(devices.id, d.id))
        .run();
      adminSseManager.broadcast("device_status", {
        deviceId: d.id,
        connectionCount: 0,
      });
    }
  }
```

- [ ] **Step 4: Update imports**

At the top of the file, ensure `and` and `gt` are imported from `drizzle-orm`:

```typescript
import { eq, sql, inArray, and, gt } from "drizzle-orm";
```

- [ ] **Step 5: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no errors in this file.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agent/status/route.ts
git commit -m "feat(api): persist xray traffic, connection count, forward bytes from agent reports"
```

---

## Task 8: Platform — include new fields in device list/detail responses

**Files:**
- Modify: `src/app/api/devices/route.ts:53-73` (GET list)
- Modify: `src/app/api/devices/[id]/route.ts` (GET detail)

- [ ] **Step 1: Extend list response**

In `src/app/api/devices/route.ts`, in the `db.select({...}).from(devices)` chain (around line 53), add these fields to the select object:

```typescript
      uploadBytes: devices.uploadBytes,
      downloadBytes: devices.downloadBytes,
      connectionCount: devices.connectionCount,
```

(No need to include `activeIps` in list — only in detail.)

- [ ] **Step 2: Extend detail response**

In `src/app/api/devices/[id]/route.ts`, find the select in the GET handler and add:

```typescript
      uploadBytes: devices.uploadBytes,
      downloadBytes: devices.downloadBytes,
      connectionCount: devices.connectionCount,
      activeIps: devices.activeIps,
```

- [ ] **Step 3: Verify**

Run: `curl -s -b /tmp/wm_cookies.txt http://localhost:3456/api/devices?page=1&pageSize=1 | python3 -m json.tool | head -25`
Expected: response includes `uploadBytes`, `downloadBytes`, `connectionCount`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/devices/route.ts src/app/api/devices/[id]/route.ts
git commit -m "feat(api): expose device traffic and connection count in list/detail"
```

---

## Task 9: Platform — dashboard aggregation

**Files:**
- Modify: `src/app/api/dashboard/route.ts`

- [ ] **Step 1: Add forward bytes to node traffic rows**

Locate the `nodeTraffic` aggregation (around lines 32-61 based on prior audit). The query sums `uploadBytes`/`downloadBytes` from `node_status` per node. Extend the aggregation to also sum `forwardUploadBytes` and `forwardDownloadBytes`. Example shape:

```typescript
  const nodeTraffic = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      uploadBytes: sql<number>`COALESCE(SUM(${nodeStatus.uploadBytes}), 0)`,
      downloadBytes: sql<number>`COALESCE(SUM(${nodeStatus.downloadBytes}), 0)`,
      forwardUploadBytes: sql<number>`COALESCE(SUM(${nodeStatus.forwardUploadBytes}), 0)`,
      forwardDownloadBytes: sql<number>`COALESCE(SUM(${nodeStatus.forwardDownloadBytes}), 0)`,
    })
    .from(nodes)
    .leftJoin(nodeStatus, eq(nodeStatus.nodeId, nodes.id))
    .groupBy(nodes.id)
    .all();
```

(Adjust to match the exact existing structure — do NOT invent a new query style; preserve it.)

- [ ] **Step 2: Verify**

Run: `curl -s -b /tmp/wm_cookies.txt http://localhost:3456/api/dashboard | python3 -m json.tool | grep -E "forward|upload|download" | head -10`
Expected: `forwardUploadBytes` / `forwardDownloadBytes` appear.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/dashboard/route.ts
git commit -m "feat(api): include forward-tunnel bytes in dashboard node traffic"
```

---

## Task 10: Shared byte formatter util

**Files:**
- Create: `src/lib/format-bytes.ts`
- Modify: `src/components/node-status-chart.tsx` (import from new util)

- [ ] **Step 1: Create the util**

Create `src/lib/format-bytes.ts`:

```typescript
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
```

- [ ] **Step 2: Replace local formatBytes in node-status-chart**

In `src/components/node-status-chart.tsx`, DELETE the local `formatBytes` function (lines 39-50) and add at the top of the imports:

```typescript
import { formatBytes } from "@/lib/format-bytes";
```

- [ ] **Step 3: Verify the chart still works**

Open `/nodes/<id>` in the browser (dev server). Chart should render.

- [ ] **Step 4: Commit**

```bash
git add src/lib/format-bytes.ts src/components/node-status-chart.tsx
git commit -m "refactor: extract formatBytes to shared util"
```

---

## Task 11: StatusDotWithCount shared component

**Files:**
- Create: `src/components/status-dot-with-count.tsx`

- [ ] **Step 1: Create component**

Create `src/components/status-dot-with-count.tsx`:

```typescript
import { StatusDot } from "./status-dot";

export function StatusDotWithCount({
  status,
  label,
  count,
  className,
}: {
  status: string;
  label: string;
  count?: number | null;
  className?: string;
}) {
  const showCount = status === "online" && typeof count === "number" && count >= 2;
  return (
    <StatusDot
      status={status}
      label={showCount ? `${label} x ${count}` : label}
      className={className}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/status-dot-with-count.tsx
git commit -m "feat(ui): add StatusDotWithCount component"
```

---

## Task 12: i18n keys

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add zh-CN keys**

In `messages/zh-CN.json`, under `devices` add (merge with existing keys):

```json
    "traffic": "流量",
    "uploadShort": "↑",
    "downloadShort": "↓",
    "trafficStats": "流量统计",
    "cumulativeUpload": "累计上行",
    "cumulativeDownload": "累计下行",
    "activeConnections": "活跃连接",
    "sourceIp": "来源 IP",
    "lastSeen": "最近活跃",
    "noActiveConnections": "当前没有活跃连接",
```

Under `nodeStatusChart` add:
```json
    "forwardUpload": "转发上行",
    "forwardDownload": "转发下行",
```

Under `dashboard` add:
```json
    "entryUpload": "入口 ↑",
    "entryDownload": "入口 ↓",
    "forwardUpload": "转发 ↑",
    "forwardDownload": "转发 ↓",
```

- [ ] **Step 2: Add en keys**

In `messages/en.json`, mirror the same keys:

```json
    "traffic": "Traffic",
    "uploadShort": "↑",
    "downloadShort": "↓",
    "trafficStats": "Traffic Statistics",
    "cumulativeUpload": "Cumulative Upload",
    "cumulativeDownload": "Cumulative Download",
    "activeConnections": "Active Connections",
    "sourceIp": "Source IP",
    "lastSeen": "Last Seen",
    "noActiveConnections": "No active connections",
```

```json
    "forwardUpload": "Forward Up",
    "forwardDownload": "Forward Down",
```

```json
    "entryUpload": "Entry ↑",
    "entryDownload": "Entry ↓",
    "forwardUpload": "Forward ↑",
    "forwardDownload": "Forward ↓",
```

- [ ] **Step 3: Validate JSON**

Run: `for f in messages/*.json; do python3 -m json.tool "$f" > /dev/null && echo "$f OK"; done`
Expected: both OK.

- [ ] **Step 4: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git commit -m "feat(i18n): add traffic and connection stats keys"
```

---

## Task 13: Device list page — traffic column + status with count

**Files:**
- Modify: `src/app/(dashboard)/devices/page.tsx`

- [ ] **Step 1: Update imports**

Replace the `StatusDot` import with:

```typescript
import { StatusDotWithCount } from "@/components/status-dot-with-count";
import { formatBytes } from "@/lib/format-bytes";
```

If `StatusDot` is still used elsewhere in the file, keep both imports.

- [ ] **Step 2: Update the Device type (if locally typed)**

Find the `type Device = { ... }` declaration. Add:

```typescript
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
```

- [ ] **Step 3: Add traffic column to the columns array**

Find the columns array (around line 216-299 based on audit). AFTER the `line` column and BEFORE `statusCol`, insert:

```typescript
    {
      key: "traffic",
      header: t("traffic"),
      render: (row: Device) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          ↑ {formatBytes(row.uploadBytes)} / ↓ {formatBytes(row.downloadBytes)}
        </span>
      ),
    },
```

- [ ] **Step 4: Swap the status renderer**

Change the `statusCol` render from `<StatusDot .../>` to `<StatusDotWithCount status={row.status} label={t(`status.${row.status}`)} count={row.connectionCount} />`.

- [ ] **Step 5: Verify visually**

Open `/devices` in the browser. Verify:
- Traffic column renders `↑ X / ↓ Y`
- Offline devices show `0 B / 0 B`
- Status column still works

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/devices/page.tsx
git commit -m "feat(ui): add traffic column and connection-aware status to device list"
```

---

## Task 14: Device detail — traffic card + active IPs card

**Files:**
- Modify: `src/app/(dashboard)/devices/[id]/page.tsx`

- [ ] **Step 1: Extend Device type**

Add the three new fields (and `activeIps: string | null`) to the device type in this file. See Task 8 for the exact fields.

- [ ] **Step 2: Update imports**

```typescript
import { StatusDotWithCount } from "@/components/status-dot-with-count";
import { formatBytes } from "@/lib/format-bytes";
```

- [ ] **Step 3: Replace header StatusDot with StatusDotWithCount**

In the header section (line 158-167 per audit) swap in `StatusDotWithCount` (pass `count={device.connectionCount}`).

- [ ] **Step 4: Add Traffic Stats card**

After the "设备信息" Card (around line 213), insert:

```tsx
<Card>
  <CardHeader>
    <CardTitle>{t("trafficStats")}</CardTitle>
  </CardHeader>
  <CardContent className="grid grid-cols-2 gap-4">
    <div>
      <div className="text-sm text-muted-foreground">{t("cumulativeUpload")}</div>
      <div className="text-2xl font-semibold">{formatBytes(device.uploadBytes)}</div>
    </div>
    <div>
      <div className="text-sm text-muted-foreground">{t("cumulativeDownload")}</div>
      <div className="text-2xl font-semibold">{formatBytes(device.downloadBytes)}</div>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 5: Add Active Connections card (Xray only)**

Insert after the Traffic Stats card:

```tsx
{device.protocol === "xray" && (
  <Card>
    <CardHeader>
      <CardTitle>{t("activeConnections")}</CardTitle>
    </CardHeader>
    <CardContent>
      {(() => {
        const ips: { ip: string; last_seen: number }[] = device.activeIps
          ? JSON.parse(device.activeIps)
          : [];
        if (ips.length === 0) {
          return <div className="text-sm text-muted-foreground">{t("noActiveConnections")}</div>;
        }
        return (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">{t("sourceIp")}</th>
                <th className="py-1 font-medium">{t("lastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {ips.map((entry) => (
                <tr key={entry.ip} className="border-t">
                  <td className="py-1 font-mono">{entry.ip}</td>
                  <td className="py-1">{new Date(entry.last_seen * 1000).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 6: Verify visually**

Open `/devices/<id>` for a Xray device. Should see traffic card (with 0 B if new) and active connections card (empty initially).

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/devices/[id]/page.tsx
git commit -m "feat(ui): add traffic stats and active connections cards to device detail"
```

---

## Task 15: Node detail — extend traffic chart with forward series

**Files:**
- Modify: `src/components/node-status-chart.tsx`

- [ ] **Step 1: Extend types**

Modify `StatusRecord` and `ChartPoint` types:

```typescript
type StatusRecord = {
  isOnline: boolean;
  latency: number | null;
  uploadBytes: number;
  downloadBytes: number;
  forwardUploadBytes: number;
  forwardDownloadBytes: number;
  checkedAt: string;
};

type ChartPoint = {
  time: string;
  latency: number | null;
  upload: number;
  download: number;
  forwardUpload: number;
  forwardDownload: number;
};
```

- [ ] **Step 2: Map new fields in the data transform**

Inside the `.then((json) => { ... })` block, update the `mapped` loop:

```typescript
const mapped: ChartPoint[] = reversed.map((r) => {
  const date = new Date(r.checkedAt);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return {
    time: `${hh}:${mm}`,
    latency: r.latency,
    upload: r.uploadBytes,
    download: r.downloadBytes,
    forwardUpload: r.forwardUploadBytes ?? 0,
    forwardDownload: r.forwardDownloadBytes ?? 0,
  };
});
```

- [ ] **Step 3: Add two more Area series in the traffic chart**

After the existing two `<Area>` elements (for `upload` and `download`), add:

```tsx
<Area
  type="monotone"
  dataKey="forwardUpload"
  stroke="hsl(var(--chart-3))"
  fill="hsl(var(--chart-3))"
  fillOpacity={0.15}
  name={t("forwardUpload")}
/>
<Area
  type="monotone"
  dataKey="forwardDownload"
  stroke="hsl(var(--chart-4))"
  fill="hsl(var(--chart-4))"
  fillOpacity={0.15}
  name={t("forwardDownload")}
/>
```

- [ ] **Step 4: Ensure API returns the new fields**

Check `src/app/api/nodes/[id]/status/route.ts`. If it selects specific columns, add `forwardUploadBytes` and `forwardDownloadBytes`. If it does `SELECT *`, no change needed.

- [ ] **Step 5: Verify visually**

Open `/nodes/<exit_node_id>` — chart should render with forward series visible (0 initially, populating over time as traffic flows).

- [ ] **Step 6: Commit**

```bash
git add src/components/node-status-chart.tsx src/app/api/nodes/[id]/status/route.ts
git commit -m "feat(ui): add forward traffic series to node status chart"
```

---

## Task 16: Dashboard — status with count + forward columns

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Update imports**

```typescript
import { StatusDotWithCount } from "@/components/status-dot-with-count";
```

- [ ] **Step 2: Extend device type and response**

Where the devices list is fetched/typed, add `connectionCount: number`.

- [ ] **Step 3: Replace StatusDot with StatusDotWithCount in device table**

In the "设备状态" table (line 214-261 per audit), change the status cell's `<StatusDot>` to `<StatusDotWithCount count={row.connectionCount} .../>`.

- [ ] **Step 4: Extend node-traffic table columns**

The existing node traffic table has 4 columns (name, IP, upload, download). Replace the traffic-bytes columns with 4 columns (entry ↑, entry ↓, forward ↑, forward ↓). If a column value is 0 for that role, display `—`.

Example for a render function:

```tsx
render: (row: NodeTrafficRow) => (
  <span className="text-xs whitespace-nowrap">
    {row.uploadBytes > 0 ? formatBytes(row.uploadBytes) : "—"}
  </span>
)
```

Do this for `uploadBytes`, `downloadBytes`, `forwardUploadBytes`, `forwardDownloadBytes`.

- [ ] **Step 5: Verify visually**

Open `/dashboard`. Node traffic table should show 4 data columns. Device status table should show "在线 x N" for Xray devices with multiple IPs.

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat(ui): dashboard shows connection count and forward bytes per node"
```

---

## Task 17: End-to-end verification

**Files:** none (observation only)

- [ ] **Step 1: Prep environment**

Agent is already deployed to Guangzhou + Singapore (Task 6). Dev server is running.

Verify a Xray device exists and is functional:
- Device "test-xray" on Line "广州->新加坡"

If no device, create one via the UI.

- [ ] **Step 2: Start one Xray client container**

```bash
docker run -d --name wm-verify-1 -v /tmp/wm-xray-test:/etc/xray:ro wm-test \
  sh -c 'while true; do /etc/xray/xray run -c /etc/xray/client.json; sleep 2; done'
docker exec -d wm-verify-1 sh -c 'while true; do curl -s --max-time 5 --proxy socks5h://127.0.0.1:1080 http://ifconfig.me/ip > /dev/null; sleep 3; done'
```

Wait ~40s (one full agent poll cycle + SSE delivery).

- [ ] **Step 3: Verify in DB**

```bash
sqlite3 data/wiremesh.db 'SELECT id, name, status, upload_bytes, download_bytes, connection_count, active_ips FROM devices;'
```

Expected: `test-xray` row has `upload_bytes > 0`, `download_bytes > 0`, `connection_count = 1`, `active_ips` JSON array of length 1.

- [ ] **Step 4: Verify in UI**

Open `/devices`. Verify:
- Traffic column shows non-zero `↑ X / ↓ Y`
- Status shows `在线` (no "x N" because count=1)

Open `/devices/<xray_device_id>`. Verify:
- Traffic card shows non-zero values
- Active Connections card shows 1 IP with a recent timestamp

- [ ] **Step 5: Add a second client (different IP) via Singapore node**

```bash
sshpass -p 'Ab123456..' scp -o StrictHostKeyChecking=no /tmp/wm-xray-test/client.json /tmp/wm-xray-test/xray root@47.84.76.136:/tmp/
sshpass -p 'Ab123456..' ssh -o StrictHostKeyChecking=no root@47.84.76.136 \
  "chmod +x /tmp/xray && nohup /tmp/xray run -c /tmp/client.json > /tmp/xray.log 2>&1 & sleep 3 && nohup sh -c 'while true; do curl -s --max-time 5 --proxy socks5h://127.0.0.1:1080 http://ifconfig.me/ip > /dev/null; sleep 3; done' > /dev/null 2>&1 & disown"
```

Wait ~40s.

- [ ] **Step 6: Verify "在线 x 2"**

Open `/devices`. Status column should now show `在线 x 2` for the Xray device.

Open device detail — Active Connections card should list 2 IPs.

- [ ] **Step 7: Verify node forward traffic**

Open `/nodes/<singapore_node_id>`. Traffic chart should show forward-upload/forward-download series with increasing values.

Also check dashboard `/dashboard` — node traffic table should show forward columns populated for Singapore node (exit), entry columns `—` for Singapore (pure exit).

- [ ] **Step 8: Cleanup**

```bash
docker rm -f wm-verify-1
sshpass -p 'Ab123456..' ssh -o StrictHostKeyChecking=no root@47.84.76.136 \
  "pkill -f 'xray run' 2>/dev/null; pkill -f 'curl.*socks5h' 2>/dev/null; rm -f /tmp/xray /tmp/client.json /tmp/xray.log"
```

- [ ] **Step 9: No commit (verification only)**

---

## Self-Review Notes

**Spec coverage:**
- ① Xray device traffic → Task 2 (policy), Task 4 (agent collector), Task 7 (persist), Task 8 (API), Task 13/14 (UI) ✓
- ① Xray connection count → Task 4 (collector), Task 7 (persist), Task 11 (UI component), Task 13/14/16 (UI usage) ✓
- ② Forward-tunnel traffic → Task 1 (schema), Task 5 (collector), Task 7 (persist), Task 9 (dashboard API), Task 15/16 (UI) ✓
- Active IP list → Task 4 (collector), Task 7 (persist), Task 8 (API), Task 14 (UI) ✓
- Device list traffic column → Task 13 ✓
- Dashboard forward columns → Task 16 ✓
- Node detail chart extension → Task 15 ✓
- E2E verification → Task 17 ✓

**Known trade-offs documented in spec:**
- NAT-shared IPs collapse to 1 in connection count (intrinsic to IP-based counting)
- Forward bytes on entry nodes ≈ wm-wg0 bytes (displayed as separate columns so user can distinguish transit vs device traffic)
- Xray restart resets per-user counters; agent delta logic already handles this via `if delta < 0 { delta = current }`

**Type consistency check:** all Go struct names, TS interface fields, and SQL column names verified consistent across tasks.
