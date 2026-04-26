# 隧道运行时状态展示与端口黑名单 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在线路详情页「隧道信息」展示每条隧道的最近握手时间和收发流量，提供刷新按钮触发实时上报；同时增加节点级端口黑名单与一键重新分配端口能力，避免再踩到云防火墙屏蔽的坏端口。

**Architecture:** 复用 agent 现有 `POST /api/agent/status` 上报通道，扩展 `StatusReport` 携带 `wm-tun*` 状态；平台收到后存进程内 `Map<nodeId, snapshot>` 缓存（不持久化）；刷新 = 通过 SSE 单向通知 agent 立即触发一次上报，平台等待 1.5 秒后读最新缓存返回。端口黑名单作为 `nodes` 表的 CSV 字段，allocator 取两端节点黑名单的并集排除。

**Tech Stack:** Next.js 16 + React 19 + drizzle-orm (better-sqlite3) + vitest（前端单测）+ Go 1.x + go test（agent）+ next-intl。

---

## File Structure

**新建（platform）**：
- `drizzle/0011_node_port_blacklist.sql` — schema migration
- `src/lib/tunnel-status-cache.ts` — 进程内 snapshot 缓存
- `src/app/api/lines/[id]/tunnels/route.ts` — GET 拼装隧道状态
- `src/app/api/lines/[id]/tunnels/refresh/route.ts` — POST 触发刷新
- `src/app/api/line-tunnels/[id]/reallocate/route.ts` — POST 重新分配端口

**修改（platform）**：
- `src/lib/db/schema.ts` — `nodes` 表加字段
- `src/lib/ip-allocator.ts` — 加 blacklist 参数 + 解析函数
- `src/app/api/lines/route.ts` — 调 allocator 时传黑名单
- `src/app/api/agent/status/route.ts` — 写隧道状态进缓存
- `src/app/(dashboard)/lines/[id]/page.tsx` — 表格加 2 列 + 刷新按钮 + 重新分配按钮
- `src/app/(dashboard)/nodes/[id]/page.tsx` — 黑名单管理 UI
- `messages/zh-CN.json`、`messages/en.json` — i18n

**新建（agent）**：
- `agent/wg/exec.go` — 加 `WgShowAllDump` 函数

**修改（agent）**：
- `agent/api/status.go` — `StatusReport` 加 `TunnelStatuses` 字段
- `agent/collector/collector.go` — 收集 wm-tun* 状态
- `agent/agent/agent.go` — 事件 dispatch 加 `request_status_report`
- 测试：`__tests__/lib/ip-allocator.test.ts`、`agent/collector/collector_test.go`

---

## Task 1: Schema 改动 — `nodes.tunnel_port_blacklist`

**Files:**
- Modify: `src/lib/db/schema.ts:31-56`
- Create: `drizzle/0011_node_port_blacklist.sql`

- [ ] **Step 1: 编辑 schema.ts，给 `nodes` 表加字段**

在 `src/lib/db/schema.ts` 中找到 `nodes = sqliteTable("nodes", { ... })`（第 31 行起），在 `pendingDelete` 字段后追加：

```typescript
  pendingDelete: integer("pending_delete", { mode: "boolean" }).notNull().default(false),
  tunnelPortBlacklist: text("tunnel_port_blacklist").notNull().default(""),
```

- [ ] **Step 2: 写 migration 文件**

创建 `drizzle/0011_node_port_blacklist.sql`，内容：

```sql
ALTER TABLE `nodes` ADD `tunnel_port_blacklist` text DEFAULT '' NOT NULL;
```

（参考 `drizzle/0010_add_filter_sync_status.sql` 的 ALTER 语法风格）

- [ ] **Step 3: 应用 migration（dev 环境）**

Run:
```bash
npm run dev &
DEV_PID=$!
sleep 5
sqlite3 /www/server/panel/data/compose/wiremesh.dootask.com/data/wiremesh.db ".schema nodes" | grep tunnel_port_blacklist
kill $DEV_PID
```

Expected: 输出包含 `tunnel_port_blacklist`。如果你本机没那条数据库路径，改用项目内 sqlite 文件路径或跳过这一步——下一次 `npm run dev` 启动时 drizzle 会自动应用。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0011_node_port_blacklist.sql
git commit -m "feat(schema): add tunnel_port_blacklist field to nodes"
```

---

## Task 2: ip-allocator — blacklist 参数（TDD）

**Files:**
- Modify: `src/lib/ip-allocator.ts:72-78`
- Test: `__tests__/lib/ip-allocator.test.ts:90-107`

- [ ] **Step 1: 写失败的测试**

在 `__tests__/lib/ip-allocator.test.ts` 文件末尾（最后一个 `});` 闭合 `describe("allocateTunnelPort", ...)` 之前，**替换** `describe("allocateTunnelPort", () => {...})` 块，加入新测试：

```typescript
  describe("allocateTunnelPort", () => {
    it("returns startPort when no ports are used", () => {
      expect(allocateTunnelPort([], 51820)).toBe(51820);
    });

    it("skips used ports", () => {
      expect(allocateTunnelPort([51820, 51821], 51820)).toBe(51822);
    });

    it("finds gap in non-contiguous used ports", () => {
      expect(allocateTunnelPort([51820, 51822], 51820)).toBe(51821);
    });

    it("throws when no ports available", () => {
      const used = Array.from({ length: 65534 }, (_, i) => i + 1);
      expect(() => allocateTunnelPort(used, 1)).toThrow("No available tunnel ports");
    });

    it("skips blacklisted ports", () => {
      const blacklist = new Set([51820, 51821]);
      expect(allocateTunnelPort([], 51820, blacklist)).toBe(51822);
    });

    it("skips both used and blacklisted ports", () => {
      const blacklist = new Set([51822]);
      expect(allocateTunnelPort([51820, 51821], 51820, blacklist)).toBe(51823);
    });

    it("treats empty blacklist same as no blacklist arg", () => {
      const blacklist = new Set<number>();
      expect(allocateTunnelPort([51820], 51820, blacklist)).toBe(51821);
    });
  });

  describe("parseTunnelPortBlacklist", () => {
    it("returns empty array for empty string", () => {
      expect(parseTunnelPortBlacklist("")).toEqual([]);
    });

    it("parses comma-separated ports", () => {
      expect(parseTunnelPortBlacklist("41834,41835,41840")).toEqual([41834, 41835, 41840]);
    });

    it("trims whitespace", () => {
      expect(parseTunnelPortBlacklist(" 41834 , 41835 ")).toEqual([41834, 41835]);
    });

    it("filters out invalid entries (non-numeric, out of range)", () => {
      expect(parseTunnelPortBlacklist("41834,abc,99999,0,-5,41835")).toEqual([41834, 41835]);
    });
  });
```

并在 `import` 行加上 `parseTunnelPortBlacklist`：

```typescript
import {
  allocateNodeIp,
  allocateDeviceIp,
  allocateTunnelSubnet,
  allocateTunnelPort,
  parseTunnelPortBlacklist,
} from "@/lib/ip-allocator";
```

- [ ] **Step 2: 跑测试，确认相关用例 fail**

Run: `npm test -- ip-allocator`

Expected: 现有的 4 个测试通过；新增的 7 个 blacklist + parseTunnelPortBlacklist 测试**全部失败**（导入错误或行为不符）。

- [ ] **Step 3: 实现 allocator 改造**

修改 `src/lib/ip-allocator.ts`，**替换**第 72-78 行的 `allocateTunnelPort` 函数：

```typescript
export function allocateTunnelPort(
  usedPorts: number[],
  startPort: number,
  blacklist: Set<number> = new Set()
): number {
  const usedSet = new Set(usedPorts);
  for (let port = startPort; port < 65535; port++) {
    if (!usedSet.has(port) && !blacklist.has(port)) return port;
  }
  throw new Error("No available tunnel ports");
}

export function parseTunnelPortBlacklist(csv: string): number[] {
  return csv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}
```

- [ ] **Step 4: 跑测试，确认全部通过**

Run: `npm test -- ip-allocator`

Expected: 11 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/ip-allocator.ts __tests__/lib/ip-allocator.test.ts
git commit -m "feat(allocator): support port blacklist for tunnel allocation"
```

---

## Task 3: lines API 调 allocator 时传黑名单

**Files:**
- Modify: `src/app/api/lines/route.ts:170-185, 250-290`

- [ ] **Step 1: import 新函数**

在 `src/app/api/lines/route.ts` 顶部 import 区找到 `allocateTunnelPort` 的导入行（应该已经存在），改成：

```typescript
import { allocateTunnelPort, allocateTunnelSubnet, parseTunnelPortBlacklist } from "@/lib/ip-allocator";
```

如果原来 import 不长这样，确保把 `parseTunnelPortBlacklist` 加进去。

- [ ] **Step 2: 在分配循环里读取节点黑名单**

在第 250 行附近的 `// 3c. Create lineTunnels for the chain` 块里，把 `for (let i = 0; i < chainNodeIds.length - 1; i++)` 循环体修改成：

```typescript
      for (let i = 0; i < chainNodeIds.length - 1; i++) {
        const fromNodeId = chainNodeIds[i];
        const toNodeId = chainNodeIds[i + 1];

        const { fromAddress, toAddress } = allocateTunnelSubnet(
          usedAddresses,
          tunnelSubnet
        );
        usedAddresses.push(fromAddress, toAddress);

        // Read both ends' port blacklists; allocator will skip ports in either.
        const fromNode = db.select({ blacklist: nodes.tunnelPortBlacklist })
          .from(nodes).where(eq(nodes.id, fromNodeId)).get();
        const toNode = db.select({ blacklist: nodes.tunnelPortBlacklist })
          .from(nodes).where(eq(nodes.id, toNodeId)).get();
        const portBlacklist = new Set([
          ...parseTunnelPortBlacklist(fromNode?.blacklist ?? ""),
          ...parseTunnelPortBlacklist(toNode?.blacklist ?? ""),
        ]);

        const fromPort = allocateTunnelPort(usedPorts, tunnelPortStart, portBlacklist);
        usedPorts.push(fromPort);
        const toPort = allocateTunnelPort(usedPorts, tunnelPortStart, portBlacklist);
        usedPorts.push(toPort);

        const fromKeyPair = generateKeyPair();
        const toKeyPair = generateKeyPair();

        db.insert(lineTunnels)
          .values({
            lineId: line.id,
            hopIndex: globalHopIndex,
            fromNodeId,
            toNodeId,
            fromWgPrivateKey: encrypt(fromKeyPair.privateKey),
            fromWgPublicKey: fromKeyPair.publicKey,
            fromWgAddress: fromAddress,
            fromWgPort: fromPort,
            toWgPrivateKey: encrypt(toKeyPair.privateKey),
            toWgPublicKey: toKeyPair.publicKey,
            toWgAddress: toAddress,
            toWgPort: toPort,
            branchId: branchRecord.id,
          })
          .run();

        globalHopIndex++;
      }
```

- [ ] **Step 3: 验证不破坏现有创建流程**

启动 dev server，在管理后台创建一条测试线路（任意两个节点），确认：
- 创建成功
- 数据库 `line_tunnels` 表有新行
- 端口分配从 `tunnel_port_start` 起、不踩任何节点黑名单

Run:
```bash
npm run dev &
sleep 5
# 在浏览器创建一条测试线路；或用 curl 调 POST /api/lines
sqlite3 <db_path> "SELECT id, from_wg_port, to_wg_port FROM line_tunnels ORDER BY id DESC LIMIT 3;"
```

Expected: 看到新行，端口在合理范围（≥ 41830）。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/lines/route.ts
git commit -m "feat(lines): pass per-node port blacklist to allocator"
```

---

## Task 4: Agent — `wg show all dump` 封装

**Files:**
- Modify: `agent/wg/exec.go`

- [ ] **Step 1: 加 WgShowAllDump 函数**

在 `agent/wg/exec.go` 文件末尾追加：

```go
// WgShowAllDump runs `wg show all dump` and returns raw stdout.
// Output format (tab-separated):
//   <iface>  <private-key>  <public-key>  <listen-port>  <fwmark>          (interface line, 5 fields)
//   <iface>  <pubkey>  <preshared>  <endpoint>  <allowed-ips>  <latest-handshake>  <rx-bytes>  <tx-bytes>  <keepalive>   (peer line, 9 fields)
// Caller distinguishes interface vs peer lines by field count.
func WgShowAllDump() (string, error) {
	out, err := exec.Command("wg", "show", "all", "dump").Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
```

确认文件顶部已有 `import "os/exec"` 等导入。

- [ ] **Step 2: 编译 agent 确认无语法错误**

Run:
```bash
cd agent
go build ./...
```

Expected: 无输出（编译成功）。

- [ ] **Step 3: Commit**

```bash
git add agent/wg/exec.go
git commit -m "feat(agent): add WgShowAllDump helper"
```

---

## Task 5: Agent — `StatusReport.TunnelStatuses` + 解析（TDD）

**Files:**
- Modify: `agent/api/status.go`
- Modify: `agent/collector/collector.go`
- Test: `agent/collector/collector_test.go`

- [ ] **Step 1: 加 TunnelStatusReport 类型**

在 `agent/api/status.go` 的 `StatusReport` struct 里添加字段：

```go
type StatusReport struct {
	IsOnline         bool                   `json:"is_online"`
	Latency          *int                   `json:"latency,omitempty"`
	Transfers        []TransferReport       `json:"transfers,omitempty"`
	Handshakes       []HandshakeReport      `json:"handshakes,omitempty"`
	XrayOnlineUsers  []string               `json:"xray_online_users,omitempty"`
	XrayTransfers    []XrayTransferReport   `json:"xray_transfers,omitempty"`
	XrayConnections  []XrayConnectionReport `json:"xray_connections,omitempty"`
	Socks5Transfers  []Socks5TransferReport `json:"socks5_transfers,omitempty"`
	ForwardUpload    int64                  `json:"forward_upload,omitempty"`
	ForwardDownload  int64                  `json:"forward_download,omitempty"`
	AgentVersion     string                 `json:"agent_version,omitempty"`
	XrayVersion      string                 `json:"xray_version,omitempty"`
	XrayRunning      bool                   `json:"xray_running"`
	TunnelStatuses   []TunnelStatusReport   `json:"tunnel_statuses,omitempty"`
}
```

并在文件末尾追加：

```go
// TunnelStatusReport: snapshot of one wm-tun* peer's wg state at report time.
// LastHandshake is unix seconds (0 = never handshaked).
type TunnelStatusReport struct {
	Iface         string `json:"iface"`
	PeerPublicKey string `json:"peer_public_key"`
	LastHandshake int64  `json:"last_handshake"`
	RxBytes       int64  `json:"rx_bytes"`
	TxBytes       int64  `json:"tx_bytes"`
}
```

- [ ] **Step 2: 写失败的解析测试**

在 `agent/collector/collector_test.go` 文件末尾追加：

```go
func TestParseTunnelStatuses(t *testing.T) {
	// Sample wg show all dump output (tab-separated).
	// First line for each iface is the interface line (5 fields).
	// Subsequent lines for that iface are peer lines (9 fields).
	input := "wm-wg0\tabcPRIV=\tabcPUB=\t41820\toff\n" +
		"wm-wg0\tdevicePeer=\t(none)\t(none)\t10.210.0.100/32\t1777111630\t1024\t2048\t0\n" +
		"wm-tun11\titun11PRIV=\titun11PUB=\t41834\toff\n" +
		"wm-tun11\tpeerTun11=\t(none)\t47.84.141.78:41835\t0.0.0.0/0\t0\t0\t354100\t25\n" +
		"wm-tun6\titun6PRIV=\titun6PUB=\t41832\toff\n" +
		"wm-tun6\tpeerTun6=\t(none)\t47.84.141.78:41833\t0.0.0.0/0\t1777111600\t128000000\t226000000\t25\n"

	got := parseTunnelStatuses(input)

	if len(got) != 2 {
		t.Fatalf("parseTunnelStatuses returned %d entries, want 2 (only wm-tun*)", len(got))
	}

	// Find by iface name (order may vary)
	byIface := map[string]api.TunnelStatusReport{}
	for _, r := range got {
		byIface[r.Iface] = r
	}

	tun11, ok := byIface["wm-tun11"]
	if !ok {
		t.Fatal("wm-tun11 missing")
	}
	if tun11.PeerPublicKey != "peerTun11=" {
		t.Errorf("wm-tun11 PeerPublicKey = %q, want %q", tun11.PeerPublicKey, "peerTun11=")
	}
	if tun11.LastHandshake != 0 {
		t.Errorf("wm-tun11 LastHandshake = %d, want 0", tun11.LastHandshake)
	}
	if tun11.RxBytes != 0 {
		t.Errorf("wm-tun11 RxBytes = %d, want 0", tun11.RxBytes)
	}
	if tun11.TxBytes != 354100 {
		t.Errorf("wm-tun11 TxBytes = %d, want 354100", tun11.TxBytes)
	}

	tun6, ok := byIface["wm-tun6"]
	if !ok {
		t.Fatal("wm-tun6 missing")
	}
	if tun6.LastHandshake != 1777111600 {
		t.Errorf("wm-tun6 LastHandshake = %d, want 1777111600", tun6.LastHandshake)
	}
}

func TestParseTunnelStatuses_skipsNonTunInterfaces(t *testing.T) {
	// Only wm-wg0 (device interface) — should yield 0 results.
	input := "wm-wg0\tprivkey\tpubkey\t41820\toff\n" +
		"wm-wg0\tpeer1=\t(none)\t(none)\t10.210.0.100/32\t1777111630\t1024\t2048\t0\n"
	got := parseTunnelStatuses(input)
	if len(got) != 0 {
		t.Errorf("parseTunnelStatuses returned %d entries for non-tun input, want 0", len(got))
	}
}

func TestParseTunnelStatuses_emptyInput(t *testing.T) {
	if got := parseTunnelStatuses(""); len(got) != 0 {
		t.Errorf("parseTunnelStatuses(\"\") returned %d, want 0", len(got))
	}
}
```

- [ ] **Step 3: 跑测试，确认 fail**

Run:
```bash
cd agent && go test ./collector/ -run TestParseTunnelStatuses -v
```

Expected: `undefined: parseTunnelStatuses` 编译错误。

- [ ] **Step 4: 实现 parseTunnelStatuses**

在 `agent/collector/collector.go` 文件末尾追加：

```go
// parseTunnelStatuses parses `wg show all dump` output and returns peer rows
// for wm-tun* interfaces only. Each interface in the output emits:
//   - one interface line (5 tab-separated fields): iface, privkey, pubkey, listen-port, fwmark
//   - one peer line per peer (9 fields): iface, pubkey, preshared, endpoint, allowed-ips,
//     latest-handshake, rx, tx, keepalive
// We identify peer lines by field count == 9.
func parseTunnelStatuses(dump string) []api.TunnelStatusReport {
	var out []api.TunnelStatusReport
	for _, line := range strings.Split(dump, "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 9 {
			continue // skip interface lines and malformed rows
		}
		iface := fields[0]
		if !strings.HasPrefix(iface, "wm-tun") {
			continue
		}
		out = append(out, api.TunnelStatusReport{
			Iface:         iface,
			PeerPublicKey: fields[1],
			LastHandshake: parseInt64Safe(fields[5]),
			RxBytes:       parseInt64Safe(fields[6]),
			TxBytes:       parseInt64Safe(fields[7]),
		})
	}
	return out
}

func parseInt64Safe(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}
```

确保文件顶部 import 已有 `"strings"` 和 `"strconv"`，没有就加上。

- [ ] **Step 5: 跑测试，确认 PASS**

Run:
```bash
cd agent && go test ./collector/ -run TestParseTunnelStatuses -v
```

Expected: 3 个测试全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add agent/api/status.go agent/collector/collector.go agent/collector/collector_test.go
git commit -m "feat(agent): parse wm-tun* state from wg show all dump"
```

---

## Task 6: Agent — 把 tunnel statuses 接入周期 collect

**Files:**
- Modify: `agent/collector/collector.go`（找 `Collect()` 函数）

- [ ] **Step 1: 在 Collect() 里调 WgShowAllDump 并填充 TunnelStatuses**

打开 `agent/collector/collector.go`，找到 `Collect()` 函数（应该在文件中段，返回 `*api.StatusReport`）。在 return 前增加：

```go
	// Collect wm-tun* states (best-effort; failure shouldn't fail the whole report)
	if dump, err := wg.WgShowAllDump(); err == nil {
		report.TunnelStatuses = parseTunnelStatuses(dump)
	} else {
		log.Printf("[collector] WgShowAllDump failed: %v", err)
	}
```

import 区确保有 `"github.com/wiremesh/agent/wg"` 和 `"log"`，没有就加。

- [ ] **Step 2: 编译并跑全部 collector 测试**

Run:
```bash
cd agent && go build ./... && go test ./collector/ -v
```

Expected: 编译成功，所有 collector 测试 PASS。

- [ ] **Step 3: Commit**

```bash
git add agent/collector/collector.go
git commit -m "feat(agent): include wm-tun* statuses in periodic status report"
```

---

## Task 7: Agent — 处理 `request_status_report` SSE 事件

**Files:**
- Modify: `agent/agent/agent.go`

- [ ] **Step 1: 在 handleSSEEvent 加 case**

打开 `agent/agent/agent.go`，找到 `handleSSEEvent` 函数（第 91 行附近的 switch）。在 `case "xray_upgrade":` 之前**插入**：

```go
	case "request_status_report":
		log.Println("[agent] Received request_status_report, triggering immediate report")
		a.reportStatus()
```

确认 `a.reportStatus()` 存在（在 ticker 路径已经在用）。

- [ ] **Step 2: 编译并跑 agent 全部测试**

Run:
```bash
cd agent && go build ./... && go test ./...
```

Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add agent/agent/agent.go
git commit -m "feat(agent): handle request_status_report SSE event for immediate report"
```

---

## Task 8: Platform — `tunnel-status-cache.ts`（TDD）

**Files:**
- Create: `src/lib/tunnel-status-cache.ts`
- Test: `__tests__/lib/tunnel-status-cache.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `__tests__/lib/tunnel-status-cache.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  setNodeSnapshot,
  getNodeSnapshot,
  clearAllSnapshots,
  type TunnelStatusReport,
} from "@/lib/tunnel-status-cache";

describe("tunnel-status-cache", () => {
  beforeEach(() => {
    clearAllSnapshots();
  });

  it("returns null for unknown nodeId", () => {
    expect(getNodeSnapshot(999)).toBeNull();
  });

  it("stores and retrieves snapshot", () => {
    const tunnels: TunnelStatusReport[] = [
      { iface: "wm-tun11", peerPublicKey: "abc=", lastHandshake: 1777111630, rxBytes: 100, txBytes: 200 },
    ];
    setNodeSnapshot(5, tunnels);
    const got = getNodeSnapshot(5);
    expect(got).not.toBeNull();
    expect(got!.tunnels).toEqual(tunnels);
    expect(got!.reportedAt).toBeGreaterThan(0);
  });

  it("overwrites previous snapshot for same nodeId", () => {
    setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "a=", lastHandshake: 100, rxBytes: 0, txBytes: 0 }]);
    const firstAt = getNodeSnapshot(5)!.reportedAt;
    // wait at least 1s so reportedAt advances
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "b=", lastHandshake: 200, rxBytes: 1, txBytes: 2 }]);
        const second = getNodeSnapshot(5)!;
        expect(second.tunnels[0].peerPublicKey).toBe("b=");
        expect(second.reportedAt).toBeGreaterThanOrEqual(firstAt);
        resolve();
      }, 1100);
    });
  });

  it("isolates snapshots by nodeId", () => {
    setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "a=", lastHandshake: 100, rxBytes: 0, txBytes: 0 }]);
    setNodeSnapshot(6, [{ iface: "wm-tun11", peerPublicKey: "b=", lastHandshake: 200, rxBytes: 0, txBytes: 0 }]);
    expect(getNodeSnapshot(5)!.tunnels[0].peerPublicKey).toBe("a=");
    expect(getNodeSnapshot(6)!.tunnels[0].peerPublicKey).toBe("b=");
  });

  it("clearAllSnapshots empties the cache", () => {
    setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "a=", lastHandshake: 100, rxBytes: 0, txBytes: 0 }]);
    clearAllSnapshots();
    expect(getNodeSnapshot(5)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试，确认 fail**

Run: `npm test -- tunnel-status-cache`

Expected: 文件不存在或 import 失败。

- [ ] **Step 3: 实现 cache**

创建 `src/lib/tunnel-status-cache.ts`：

```typescript
// Process-local in-memory cache of latest tunnel status snapshots reported by agents.
//
// SINGLE-PROCESS ASSUMPTION: This cache lives in the Next.js process memory.
// Reports received in one process won't be visible to others. Acceptable for
// the current single-instance deployment. If we ever scale to multiple replicas
// (K8s, etc.), replace with Redis or another shared store.
//
// Survives Next.js dev hot-reload via globalThis singleton.

export type TunnelStatusReport = {
  iface: string;
  peerPublicKey: string;
  lastHandshake: number;  // unix seconds, 0 = never
  rxBytes: number;
  txBytes: number;
};

export type NodeSnapshot = {
  reportedAt: number;     // unix seconds, when platform received this report
  tunnels: TunnelStatusReport[];
};

type CacheStore = Map<number, NodeSnapshot>;

const CACHE_VERSION = 1;
const globalForCache = globalThis as typeof globalThis & {
  tunnelStatusCache?: CacheStore;
  tunnelStatusCacheVersion?: number;
};

if (!globalForCache.tunnelStatusCache || globalForCache.tunnelStatusCacheVersion !== CACHE_VERSION) {
  globalForCache.tunnelStatusCache = new Map();
  globalForCache.tunnelStatusCacheVersion = CACHE_VERSION;
}

const cache = globalForCache.tunnelStatusCache;

export function setNodeSnapshot(nodeId: number, tunnels: TunnelStatusReport[]): void {
  cache.set(nodeId, {
    reportedAt: Math.floor(Date.now() / 1000),
    tunnels,
  });
}

export function getNodeSnapshot(nodeId: number): NodeSnapshot | null {
  return cache.get(nodeId) ?? null;
}

export function clearAllSnapshots(): void {
  cache.clear();
}
```

- [ ] **Step 4: 跑测试，确认 PASS**

Run: `npm test -- tunnel-status-cache`

Expected: 5 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/tunnel-status-cache.ts __tests__/lib/tunnel-status-cache.test.ts
git commit -m "feat(platform): add in-memory tunnel status cache"
```

---

## Task 9: Platform — status endpoint 写缓存

**Files:**
- Modify: `src/app/api/agent/status/route.ts`

- [ ] **Step 1: 引入 cache + 写入逻辑**

打开 `src/app/api/agent/status/route.ts`，在文件顶部 import 区加一行：

```typescript
import { setNodeSnapshot } from "@/lib/tunnel-status-cache";
```

然后找到处理 `body` 的位置（在已有的 transfers/handshakes 等处理后面），追加一段：

```typescript
  // Write per-tunnel snapshot to in-memory cache for the line status UI.
  // Empty/missing tunnel_statuses is fine — older agents won't have this field.
  if (Array.isArray(body.tunnel_statuses)) {
    setNodeSnapshot(node.id, body.tunnel_statuses.map((t: {
      iface: string;
      peer_public_key: string;
      last_handshake: number;
      rx_bytes: number;
      tx_bytes: number;
    }) => ({
      iface: t.iface,
      peerPublicKey: t.peer_public_key,
      lastHandshake: t.last_handshake,
      rxBytes: t.rx_bytes,
      txBytes: t.tx_bytes,
    })));
  }
```

放在已有的 status 处理逻辑之后、return 之前。

- [ ] **Step 2: 手测端到端：启动 agent 让它上报，看 cache 有数据**

Run:
```bash
npm run dev &
sleep 5
# 重启一个测试节点的 agent（或等 30 秒让它自然上报）
# 然后调一个简单测试端点验证（下一任务会做正式 GET endpoint）
```

如果还没法验证，跳过 step 2，靠下一任务的 GET endpoint 验证。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/status/route.ts
git commit -m "feat(platform): persist agent tunnel statuses to in-memory cache"
```

---

## Task 10: Platform — `GET /api/lines/:id/tunnels`

**Files:**
- Create: `src/app/api/lines/[id]/tunnels/route.ts`

- [ ] **Step 1: 写 GET handler**

创建 `src/app/api/lines/[id]/tunnels/route.ts`：

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineTunnels, nodes } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getNodeSnapshot } from "@/lib/tunnel-status-cache";

export const dynamic = "force-dynamic";

type TunnelView = {
  id: number;
  lineId: number;
  hopIndex: number;
  fromNodeId: number;
  fromNodeName: string;
  toNodeId: number;
  toNodeName: string;
  fromWgAddress: string;
  toWgAddress: string;
  fromWgPort: number;
  toWgPort: number;
  lastHandshake: number;       // unix seconds, 0 = never
  rxBytes: number;
  txBytes: number;
  dataFromToNode: boolean;
  stale: boolean;              // true if cache > 60s old
  fromNodeReachable: boolean;
  toNodeReachable: boolean;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lineId = parseInt(id, 10);
  if (!Number.isFinite(lineId)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid line id" } }, { status: 400 });
  }

  const tunnels = db.select().from(lineTunnels).where(eq(lineTunnels.lineId, lineId)).all();
  if (tunnels.length === 0) {
    return Response.json({ lineId, lastReportedAt: null, tunnels: [] });
  }

  // Resolve node names in one query
  const nodeIds = [...new Set(tunnels.flatMap((t) => [t.fromNodeId, t.toNodeId]))];
  const nodeRows = db.select({ id: nodes.id, name: nodes.name })
    .from(nodes).where(inArray(nodes.id, nodeIds)).all();
  const nodeName = new Map(nodeRows.map((n) => [n.id, n.name]));

  const now = Math.floor(Date.now() / 1000);
  const STALE_THRESHOLD_S = 60;

  let oldestReportedAt: number | null = null;
  const view: TunnelView[] = tunnels.map((t) => {
    const ifaceName = `wm-tun${t.id}`;
    const fromSnap = getNodeSnapshot(t.fromNodeId);
    const toSnap = getNodeSnapshot(t.toNodeId);

    const fromReport = fromSnap?.tunnels.find((s) => s.iface === ifaceName) ?? null;
    const toReport = toSnap?.tunnels.find((s) => s.iface === ifaceName) ?? null;

    // Take newer handshake of the two ends
    const fromHs = fromReport?.lastHandshake ?? 0;
    const toHs = toReport?.lastHandshake ?? 0;
    const lastHandshake = Math.max(fromHs, toHs);

    // Prefer fromNode's view of rx/tx; fall back to inverted toNode view
    let rxBytes = 0, txBytes = 0, dataFromToNode = false;
    if (fromReport) {
      rxBytes = fromReport.rxBytes;
      txBytes = fromReport.txBytes;
    } else if (toReport) {
      rxBytes = toReport.txBytes;  // inverted
      txBytes = toReport.rxBytes;
      dataFromToNode = true;
    }

    // Track oldest reportedAt across both ends for the line-level lastReportedAt
    const reportedTimes = [fromSnap?.reportedAt, toSnap?.reportedAt].filter((x): x is number => typeof x === "number");
    if (reportedTimes.length > 0) {
      const oldest = Math.min(...reportedTimes);
      if (oldestReportedAt === null || oldest < oldestReportedAt) oldestReportedAt = oldest;
    }

    const stale = reportedTimes.length === 0 || (now - Math.max(...reportedTimes, 0)) > STALE_THRESHOLD_S;

    return {
      id: t.id,
      lineId: t.lineId,
      hopIndex: t.hopIndex,
      fromNodeId: t.fromNodeId,
      fromNodeName: nodeName.get(t.fromNodeId) ?? `node ${t.fromNodeId}`,
      toNodeId: t.toNodeId,
      toNodeName: nodeName.get(t.toNodeId) ?? `node ${t.toNodeId}`,
      fromWgAddress: t.fromWgAddress,
      toWgAddress: t.toWgAddress,
      fromWgPort: t.fromWgPort,
      toWgPort: t.toWgPort,
      lastHandshake,
      rxBytes,
      txBytes,
      dataFromToNode,
      stale,
      fromNodeReachable: fromSnap !== null,
      toNodeReachable: toSnap !== null,
    };
  });

  return Response.json({
    lineId,
    lastReportedAt: oldestReportedAt,
    tunnels: view,
  });
}
```

- [ ] **Step 2: 手测**

Run:
```bash
npm run dev &
sleep 5
curl -s http://localhost:3000/api/lines/1/tunnels | python3 -m json.tool
```

Expected: 返回包含 `tunnels` 数组的 JSON；如果还没有 agent 上报，`lastHandshake` 为 0，`fromNodeReachable`/`toNodeReachable` 为 `false`。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/lines/[id]/tunnels/route.ts"
git commit -m "feat(api): add GET /api/lines/:id/tunnels for runtime tunnel state"
```

---

## Task 11: Platform — `POST /api/lines/:id/tunnels/refresh`

**Files:**
- Create: `src/app/api/lines/[id]/tunnels/refresh/route.ts`

- [ ] **Step 1: 写 POST handler**

创建 `src/app/api/lines/[id]/tunnels/refresh/route.ts`：

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineTunnels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";

export const dynamic = "force-dynamic";

const REFRESH_WAIT_MS = 1500;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lineId = parseInt(id, 10);
  if (!Number.isFinite(lineId)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid line id" } }, { status: 400 });
  }

  const tunnels = db.select().from(lineTunnels).where(eq(lineTunnels.lineId, lineId)).all();
  const nodeIds = new Set<number>();
  for (const t of tunnels) {
    nodeIds.add(t.fromNodeId);
    nodeIds.add(t.toNodeId);
  }

  // Send SSE trigger to every involved node. Don't fail if some are offline —
  // the GET fall-through will simply show stale/missing data for those.
  for (const nodeId of nodeIds) {
    sseManager.sendEvent(nodeId, "request_status_report", {});
  }

  // Give agents time to receive event + collect + post status
  await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));

  // Forward to the GET endpoint via in-process self-fetch — keeps response
  // shape DRY without extracting a shared helper.
  const url = new URL(`/api/lines/${lineId}/tunnels`, _req.url);
  const r = await fetch(url, { method: "GET" });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
```

> **Note**: 内部 fetch 在 Next.js 16 下能正常工作（同进程 fetch loopback）。如果遇到性能问题或循环 fetch 报错，改成把 GET 的拼装逻辑抽到 `src/lib/build-tunnels-view.ts` 共享，POST 直接调函数。

- [ ] **Step 2: 手测**

Run:
```bash
curl -s -X POST http://localhost:3000/api/lines/1/tunnels/refresh | python3 -m json.tool
```

Expected: ~1.5 秒后返回数据（如果 agent 在线），数据应该是触发后最新的。如果 agent 离线，返回的数据等于 GET 的数据。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/lines/[id]/tunnels/refresh/route.ts"
git commit -m "feat(api): add POST /api/lines/:id/tunnels/refresh"
```

---

## Task 12: Platform — `POST /api/line-tunnels/:id/reallocate`

**Files:**
- Create: `src/app/api/line-tunnels/[id]/reallocate/route.ts`

- [ ] **Step 1: 写 reallocate handler**

创建 `src/app/api/line-tunnels/[id]/reallocate/route.ts`：

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineTunnels, nodes, settings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { allocateTunnelPort, parseTunnelPortBlacklist } from "@/lib/ip-allocator";
import { generateKeyPair } from "@/lib/wireguard";
import { encrypt } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tunnelId = parseInt(id, 10);
  if (!Number.isFinite(tunnelId)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid tunnel id" } }, { status: 400 });
  }

  const tunnel = db.select().from(lineTunnels).where(eq(lineTunnels.id, tunnelId)).get();
  if (!tunnel) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Tunnel not found" } }, { status: 404 });
  }

  // 1. Read current blacklists for both nodes
  const fromNode = db.select().from(nodes).where(eq(nodes.id, tunnel.fromNodeId)).get();
  const toNode = db.select().from(nodes).where(eq(nodes.id, tunnel.toNodeId)).get();
  if (!fromNode || !toNode) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Node not found" } }, { status: 404 });
  }

  const fromBL = new Set(parseTunnelPortBlacklist(fromNode.tunnelPortBlacklist));
  const toBL = new Set(parseTunnelPortBlacklist(toNode.tunnelPortBlacklist));

  // 2. Auto-add the current ports to each end's blacklist
  const oldFromPort = tunnel.fromWgPort;
  const oldToPort = tunnel.toWgPort;
  fromBL.add(oldFromPort);
  toBL.add(oldToPort);

  const newFromBLCsv = [...fromBL].sort((a, b) => a - b).join(",");
  const newToBLCsv = [...toBL].sort((a, b) => a - b).join(",");

  // 3. Read tunnel_port_start setting
  const startRow = db.select().from(settings).where(eq(settings.key, "tunnel_port_start")).get();
  const tunnelPortStart = parseInt(startRow?.value ?? "41830", 10);

  // 4. Collect existing used ports (excluding this tunnel's old ports)
  const allTunnels = db.select({ from: lineTunnels.fromWgPort, to: lineTunnels.toWgPort, id: lineTunnels.id }).from(lineTunnels).all();
  const usedPorts = allTunnels
    .filter((t) => t.id !== tunnelId)
    .flatMap((t) => [t.from, t.to]);

  // 5. Allocate new ports avoiding the merged blacklists (which now include the old ones)
  const combinedBL = new Set([...fromBL, ...toBL]);
  const newFromPort = allocateTunnelPort(usedPorts, tunnelPortStart, combinedBL);
  usedPorts.push(newFromPort);
  const newToPort = allocateTunnelPort(usedPorts, tunnelPortStart, combinedBL);

  // 6. Generate fresh keypairs (clean slate — don't reuse keys with new endpoint)
  const fromKp = generateKeyPair();
  const toKp = generateKeyPair();

  // 7. UPDATE the tunnel row + both nodes' blacklists in a transaction-ish sequence
  db.update(lineTunnels)
    .set({
      fromWgPort: newFromPort,
      toWgPort: newToPort,
      fromWgPrivateKey: encrypt(fromKp.privateKey),
      fromWgPublicKey: fromKp.publicKey,
      toWgPrivateKey: encrypt(toKp.privateKey),
      toWgPublicKey: toKp.publicKey,
    })
    .where(eq(lineTunnels.id, tunnelId))
    .run();

  db.update(nodes).set({ tunnelPortBlacklist: newFromBLCsv }).where(eq(nodes.id, tunnel.fromNodeId)).run();
  db.update(nodes).set({ tunnelPortBlacklist: newToBLCsv }).where(eq(nodes.id, tunnel.toNodeId)).run();

  // 8. Bump nodes.updated_at to trigger SSE reconfig
  db.update(nodes)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(eq(nodes.id, tunnel.fromNodeId))
    .run();
  db.update(nodes)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(eq(nodes.id, tunnel.toNodeId))
    .run();

  // 9. Notify agents to pull new config
  sseManager.sendEvent(tunnel.fromNodeId, "tunnel_update", {});
  sseManager.sendEvent(tunnel.toNodeId, "tunnel_update", {});

  // 10. Audit log
  writeAuditLog({
    action: "reallocate_tunnel",
    targetType: "line_tunnel",
    targetId: tunnelId,
    targetName: `tunnel#${tunnelId}`,
    detail: `old=${oldFromPort}/${oldToPort} new=${newFromPort}/${newToPort}; auto-blacklisted on nodes ${tunnel.fromNodeId},${tunnel.toNodeId}`,
  });

  return Response.json({
    ok: true,
    tunnelId,
    oldPorts: { from: oldFromPort, to: oldToPort },
    newPorts: { from: newFromPort, to: newToPort },
    blacklistAdded: { fromNodeId: tunnel.fromNodeId, toNodeId: tunnel.toNodeId },
  });
}
```

- [ ] **Step 2: 验证 audit log helper 存在**

Run:
```bash
ls src/lib/audit-log.ts && grep -n "writeAuditLog" src/lib/audit-log.ts
```

Expected: 文件存在且导出 `writeAuditLog`。如果不存在，从其他 API 文件（比如 `src/app/api/lines/route.ts:309-317`）查实际函数名调整。

- [ ] **Step 3: 手测**

```bash
# 创建一条临时测试隧道（或用现有的）
curl -s -X POST http://localhost:3000/api/line-tunnels/11/reallocate | python3 -m json.tool
sqlite3 <db> "SELECT id, from_wg_port, to_wg_port FROM line_tunnels WHERE id = 11;"
sqlite3 <db> "SELECT id, name, tunnel_port_blacklist FROM nodes WHERE id IN (5, 6);"
```

Expected: 端口换了，两端节点黑名单包含旧端口。

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/line-tunnels/[id]/reallocate/route.ts"
git commit -m "feat(api): add reallocate endpoint with auto-blacklisting"
```

---

## Task 13: i18n keys

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: 找到 line detail 命名空间，加 keys**

打开 `messages/zh-CN.json`，找到 line detail 相关命名空间（搜索现有的 `tunnelInfo` / `segment` 等 key 所在区块），在该 namespace 内追加：

```json
"lastHandshake": "最近握手",
"transfer": "收发",
"never": "从未",
"refresh": "刷新",
"refreshed": "已刷新",
"refreshFailed": "刷新失败",
"lastUpdated": "上次更新 {time}",
"staleData": "数据可能不新鲜，请点刷新",
"actions": "操作",
"reallocate": "重新分配端口",
"reallocateConfirm": "当前端口 {ports} 将加入节点黑名单，是否继续？",
"reallocateSuccess": "端口已重新分配为 {ports}",
"dataFromToNode": "数据来自终点节点",
"nodeOffline": "节点离线"
```

打开 `messages/en.json`，在对应 namespace 加：

```json
"lastHandshake": "Last handshake",
"transfer": "Transfer",
"never": "Never",
"refresh": "Refresh",
"refreshed": "Refreshed",
"refreshFailed": "Refresh failed",
"lastUpdated": "Last updated {time}",
"staleData": "Data may be stale, click refresh",
"actions": "Actions",
"reallocate": "Reallocate ports",
"reallocateConfirm": "Current ports {ports} will be added to node blacklist. Continue?",
"reallocateSuccess": "Ports reallocated to {ports}",
"dataFromToNode": "Data from to-node",
"nodeOffline": "Node offline"
```

- [ ] **Step 2: 找到 node detail 命名空间，加 keys**

在 `messages/zh-CN.json` 的节点详情命名空间加：

```json
"tunnelPortBlacklist": "隧道端口黑名单",
"tunnelPortBlacklistHint": "禁止 allocator 给该节点分配的端口（一行一个或逗号分隔）",
"addPort": "添加端口",
"invalidPort": "端口必须是 1-65535 之间的整数"
```

`messages/en.json` 对应：

```json
"tunnelPortBlacklist": "Tunnel port blacklist",
"tunnelPortBlacklistHint": "Ports that allocator will skip when assigning tunnel ports to this node (one per line or comma-separated)",
"addPort": "Add port",
"invalidPort": "Port must be an integer between 1 and 65535"
```

- [ ] **Step 3: 验证 JSON 语法**

Run:
```bash
python3 -m json.tool messages/zh-CN.json > /dev/null && python3 -m json.tool messages/en.json > /dev/null && echo OK
```

Expected: `OK`（无语法错误）。

- [ ] **Step 4: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git commit -m "feat(i18n): add tunnel status and port blacklist keys"
```

---

## Task 14: UI — 线路详情页：刷新按钮 + 两列 + 重新分配按钮

**Files:**
- Modify: `src/app/(dashboard)/lines/[id]/page.tsx:368-401`

- [ ] **Step 1: 在文件顶部 import 区加必要 hooks**

在 `src/app/(dashboard)/lines/[id]/page.tsx` 顶部找到现有的 `import` 区，确认有 `useState`、`useEffect`、`toast`、`useTranslations`，没有就加：

```typescript
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
```

- [ ] **Step 2: 在组件内加 state + fetch 逻辑**

在组件主体（找到 `const t = useTranslations(...)` 那行附近），添加：

```typescript
type TunnelView = {
  id: number; lineId: number; hopIndex: number;
  fromNodeId: number; fromNodeName: string;
  toNodeId: number; toNodeName: string;
  fromWgAddress: string; toWgAddress: string;
  fromWgPort: number; toWgPort: number;
  lastHandshake: number; rxBytes: number; txBytes: number;
  dataFromToNode: boolean; stale: boolean;
  fromNodeReachable: boolean; toNodeReachable: boolean;
};

const [tunnelStatus, setTunnelStatus] = useState<{
  lastReportedAt: number | null;
  tunnels: TunnelView[];
} | null>(null);
const [refreshing, setRefreshing] = useState(false);

const loadStatus = useCallback(async () => {
  if (!line) return;
  const r = await fetch(`/api/lines/${line.id}/tunnels`);
  if (r.ok) setTunnelStatus(await r.json());
}, [line?.id]);

useEffect(() => { loadStatus(); }, [loadStatus]);

const handleRefresh = async () => {
  if (!line) return;
  setRefreshing(true);
  try {
    const r = await fetch(`/api/lines/${line.id}/tunnels/refresh`, { method: "POST" });
    if (r.ok) {
      setTunnelStatus(await r.json());
      toast.success(t("refreshed"));
    } else {
      toast.error(t("refreshFailed"));
    }
  } finally {
    setRefreshing(false);
  }
};

const handleReallocate = async (tunnelId: number, oldFrom: number, oldTo: number) => {
  if (!confirm(t("reallocateConfirm", { ports: `${oldFrom}/${oldTo}` }))) return;
  const r = await fetch(`/api/line-tunnels/${tunnelId}/reallocate`, { method: "POST" });
  if (r.ok) {
    const data = await r.json();
    toast.success(t("reallocateSuccess", { ports: `${data.newPorts.from}/${data.newPorts.to}` }));
    // Reload page data
    location.reload();
  } else {
    toast.error("Reallocate failed");
  }
};

// Helpers for display
const formatHandshake = (unixSec: number): string => {
  if (unixSec === 0) return t("never");
  const ago = Math.floor(Date.now() / 1000) - unixSec;
  if (ago < 60) return `${ago} 秒前`;
  if (ago < 3600) return `${Math.floor(ago / 60)} 分钟前`;
  if (ago < 86400) return `${Math.floor(ago / 3600)} 小时前`;
  return `${Math.floor(ago / 86400)} 天前`;
};
const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const formatTime = (unixSec: number): string => {
  return new Date(unixSec * 1000).toLocaleTimeString();
};
```

如果 `refreshFailed` i18n key 不存在，加到 messages 里（zh: "刷新失败", en: "Refresh failed"）。

- [ ] **Step 3: 改 Tunnel info card 的 header 和 table**

找到 `{/* Tunnel info card */}` 注释下面的 `<Card>`，**替换** `<CardHeader>` 块和 `<CardContent>` 块为：

```tsx
      {/* Tunnel info card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{t("tunnelInfo")}</CardTitle>
          <div className="flex items-center gap-3">
            {tunnelStatus?.lastReportedAt && (
              <span className="text-xs text-muted-foreground">
                {t("lastUpdated", { time: formatTime(tunnelStatus.lastReportedAt) })}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {line.tunnels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTunnels")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("segment")}</TableHead>
                  <TableHead>{t("sourceNode")}</TableHead>
                  <TableHead>{t("targetNode")}</TableHead>
                  <TableHead>{t("sourceAddress")}</TableHead>
                  <TableHead>{t("targetAddress")}</TableHead>
                  <TableHead>{t("sourcePort")}</TableHead>
                  <TableHead>{t("targetPort")}</TableHead>
                  <TableHead>{t("lastHandshake")}</TableHead>
                  <TableHead>{t("transfer")}</TableHead>
                  <TableHead>{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {line.tunnels.map((tun) => {
                  const status = tunnelStatus?.tunnels.find((s) => s.id === tun.id);
                  const lastHs = status?.lastHandshake ?? 0;
                  const rx = status?.rxBytes ?? 0;
                  const tx = status?.txBytes ?? 0;
                  const stale = status?.stale ?? false;
                  const offline = status && !status.fromNodeReachable && !status.toNodeReachable;
                  const ageOK = lastHs > 0 && (Math.floor(Date.now() / 1000) - lastHs) < 300;
                  const showReallocate = !ageOK; // 5 min stale or never

                  return (
                    <TableRow key={tun.id}>
                      <TableCell>{tun.hopIndex + 1}</TableCell>
                      <TableCell>{tun.fromNodeName}</TableCell>
                      <TableCell>{tun.toNodeName}</TableCell>
                      <TableCell><code className="text-xs">{tun.fromWgAddress}</code></TableCell>
                      <TableCell><code className="text-xs">{tun.toWgAddress}</code></TableCell>
                      <TableCell>{tun.fromWgPort}</TableCell>
                      <TableCell>{tun.toWgPort}</TableCell>
                      <TableCell className={stale ? "text-muted-foreground" : ""}>
                        {offline ? "—" : formatHandshake(lastHs)}
                        {stale && !offline && (
                          <span title={t("staleData")} className="ml-1 opacity-50">ⓘ</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {offline ? "—" : `↓${formatBytes(rx)} ↑${formatBytes(tx)}`}
                      </TableCell>
                      <TableCell>
                        {showReallocate && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReallocate(tun.id, tun.fromWgPort, tun.toWgPort)}
                          >
                            {t("reallocate")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: 启动 dev server 视觉验证**

Run:
```bash
npm run dev &
sleep 5
# 浏览器打开 /lines/<id>，看：
# 1. 头部有"刷新"按钮 + "上次更新 ..."（如果有数据）
# 2. 表格末尾有 3 个新列
# 3. 点刷新按钮，spinner 转，~1.5 秒后 toast "已刷新"
# 4. 一条从未握手的隧道行末尾出现 [重新分配] 按钮
```

Expected: UI 正确显示，无 console 报错。

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/lines/[id]/page.tsx"
git commit -m "feat(ui): add tunnel runtime status columns and refresh/reallocate actions"
```

---

## Task 15: UI — 节点详情页：黑名单管理

**Files:**
- Modify: `src/app/(dashboard)/nodes/[id]/page.tsx`

- [ ] **Step 1: 在 NodeDetail type 加字段**

在 `src/app/(dashboard)/nodes/[id]/page.tsx` 顶部的 `type NodeDetail = { ... }` 里追加：

```typescript
  tunnelPortBlacklist: string;  // CSV
```

并确保获取 node 详情的 GET 在 API 里返回这个字段（看下 `src/app/api/nodes/[id]/route.ts`，把 `tunnelPortBlacklist` 加到 select 字段里——大多数情况下用 `select()` 默认会全部返回，不需要改）。

- [ ] **Step 2: 加 state + handlers**

在组件主体加：

```typescript
const [blacklistInput, setBlacklistInput] = useState("");

const blacklistPorts: number[] = node?.tunnelPortBlacklist
  ? node.tunnelPortBlacklist.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n))
  : [];

const saveBlacklist = async (newPorts: number[]) => {
  const csv = [...new Set(newPorts)].sort((a, b) => a - b).join(",");
  const r = await fetch(`/api/nodes/${node!.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tunnelPortBlacklist: csv }),
  });
  if (r.ok) {
    toast.success("Updated");
    setNode({ ...node!, tunnelPortBlacklist: csv });
  } else {
    toast.error(translateError(await r.json(), t));
  }
};

const handleAddPort = () => {
  const n = parseInt(blacklistInput.trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    toast.error(t("invalidPort"));
    return;
  }
  saveBlacklist([...blacklistPorts, n]);
  setBlacklistInput("");
};

const handleRemovePort = (port: number) => {
  saveBlacklist(blacklistPorts.filter((p) => p !== port));
};
```

- [ ] **Step 3: 加 UI 块**

在节点详情页找一个合适位置（比如端口信息附近）插入：

```tsx
<Card>
  <CardHeader>
    <CardTitle>{t("tunnelPortBlacklist")}</CardTitle>
  </CardHeader>
  <CardContent className="space-y-3">
    <p className="text-xs text-muted-foreground">{t("tunnelPortBlacklistHint")}</p>
    <div className="flex flex-wrap gap-2">
      {blacklistPorts.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : blacklistPorts.map((p) => (
        <span key={p} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs">
          {p}
          <button
            onClick={() => handleRemovePort(p)}
            className="hover:text-destructive"
            aria-label="remove"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
    <div className="flex gap-2">
      <Input
        type="number"
        min={1}
        max={65535}
        placeholder="41834"
        value={blacklistInput}
        onChange={(e) => setBlacklistInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAddPort()}
        className="w-32"
      />
      <Button size="sm" onClick={handleAddPort}>{t("addPort")}</Button>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 4: 后端支持 PATCH tunnelPortBlacklist 字段**

打开 `src/app/api/nodes/[id]/route.ts`（如果没有就创建对应 PATCH/PUT）。**仅添加** `tunnelPortBlacklist` 到允许更新的字段白名单。如果该路由用了 zod schema，给 schema 加：

```typescript
tunnelPortBlacklist: z.string().optional(),
```

并在 update 调用里：

```typescript
if (typeof body.tunnelPortBlacklist === "string") {
  updates.tunnelPortBlacklist = body.tunnelPortBlacklist;
}
```

如果具体写法不同，参考其他可编辑字段（如 `name`、`externalInterface`）的处理方式照抄。

- [ ] **Step 5: 视觉验证**

```bash
# 浏览器打开 /nodes/<id>
# 1. 看到"隧道端口黑名单"卡片
# 2. 输入 41834，点添加 -> tag 出现
# 3. 点 ✕ -> tag 消失
# 4. 数据库看 nodes.tunnel_port_blacklist 字段同步更新
sqlite3 <db> "SELECT id, name, tunnel_port_blacklist FROM nodes WHERE id = <id>;"
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/nodes/[id]/page.tsx" "src/app/api/nodes/[id]/route.ts"
git commit -m "feat(ui): add tunnel port blacklist management on node detail page"
```

---

## Task 16: 端到端验证

**Files:** 无（手测）

- [ ] **Step 1: 全栈检查**

```bash
# 1. 类型 + lint
npm run lint
npm run build

# 2. 单测
npm test

# 3. agent 测试
cd agent && go test ./... && cd ..
```

Expected: 全部通过。

- [ ] **Step 2: 在线路详情页完整走一遍**

1. 打开任意线路详情页 → 看到隧道信息表新增 3 列、刷新按钮、"上次更新"
2. 点刷新 → 1.5 秒后 toast、表格数据更新（如果 agent 在线）
3. 找一条 lastHandshake = 0 或长时间无握手的隧道 → 该行显示 [重新分配] 按钮
4. 点击 [重新分配] → confirm → 端口换成新值，对应节点黑名单加了旧端口
5. 几秒后该隧道应该重新握手成功（如果新端口不被云清洗）

- [ ] **Step 3: 在节点详情页验证黑名单 UI**

1. 节点详情页能看到「隧道端口黑名单」卡片
2. 已经被自动加进去的端口显示成 tag
3. 手动添加 / 删除 → 数据库同步

- [ ] **Step 4: 验证 allocator 不踩黑名单**

```bash
# 把节点 5 的黑名单设成 "41850,41851"
sqlite3 <db> "UPDATE nodes SET tunnel_port_blacklist='41850,41851' WHERE id=5;"
# 创建一条以节点 5 为端点、需要分配 ~41850 范围端口的新线路
# 确认新分配的端口跳过 41850/41851
sqlite3 <db> "SELECT from_wg_port, to_wg_port FROM line_tunnels ORDER BY id DESC LIMIT 1;"
```

Expected: 端口 ≠ 41850 且 ≠ 41851。

- [ ] **Step 5: 最终 commit（如有零碎修补）**

```bash
git status
# 如果有未提交的小修改：
git add .
git commit -m "chore: misc fixes after end-to-end verification"
```

---

## 完成标准

- ✅ 隧道信息板块在 UI 上多了「最近握手」「收发」「操作」三列，标题栏有刷新按钮
- ✅ 点刷新后 ~1.5 秒数据更新，agent 走现有 `/api/agent/status` 路径上报
- ✅ `nodes.tunnel_port_blacklist` 字段存在并可在节点详情页编辑
- ✅ allocator 在分配端口时跳过两端节点的黑名单并集
- ✅ 一键重新分配端口能换端口对、自动加黑名单、触发 agent 重建接口
- ✅ `npm test`、`npm run build`、`go test ./...` 全部通过
- ✅ 现有线路 / 设备 / 流量正常无回归
