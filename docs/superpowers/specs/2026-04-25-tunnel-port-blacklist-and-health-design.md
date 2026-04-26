# 隧道运行时状态展示与端口黑名单

## 背景

线路 `line_tunnels` 表里每对节点之间的 WireGuard 隧道使用 `from_wg_port`/`to_wg_port` 两个端口，由 `src/lib/ip-allocator.ts` 的 `allocateTunnelPort` 用 first-fit 策略从 `tunnel_port_start`（默认 41830）起分配。

实际运行中遇到两个问题：

1. **看不到隧道运行状态**：线路详情页的「隧道信息」板块只展示静态配置（节点、IP、端口），不知道隧道是否真的握手成功、有没有数据流。要排查得 SSH 上节点跑 `wg show`。
2. **端口踩坑无法规避**：云厂商按特定 UDP 端口对屏蔽 / 清洗流量（曾遇到 41834/41835 永远握手不成功，41832/41833 完全正常）。当前 allocator 没有跳过坏端口的机制，只能靠创建占位线路防止 allocator 复用。

## 需求

1. **隧道信息板块追加两列**：「最近握手」和「收发」，让管理员一眼看出隧道实际状态。
2. **刷新按钮**：手动触发 agent 立即上报最新数据，亚秒级反馈。
3. **端口黑名单（节点级）**：手动维护一份禁用端口集合，allocator 跳过——防止下次再踩到坏端口。
4. **隧道端口重新分配**：操作员看到坏端口后，能一键给该条隧道分配新端口（不重建整条线路），并自动把旧端口加进黑名单。

**故意不做**：自动健康判定、状态徽章（🟢🟡🔴）、自动加黑名单——避免误判，所有"动作"都让管理员显式触发。

## 设计

### 1. Schema 改动

**文件**: `src/lib/db/schema.ts` + 新建 `drizzle/0011_node_port_blacklist.sql`

只动 `nodes` 表，加一个字段：

```typescript
tunnelPortBlacklist: text("tunnel_port_blacklist").notNull().default(""),
```

CSV 字符串，例如 `"41834,41835,41840"`。空字符串表示无黑名单。**故意不用 JSON**：直接 `split(",")` + `Number` 即可。

`line_tunnels` 表**不动**——隧道运行状态完全实时，不持久化。

### 2. allocator 改造

**文件**: `src/lib/ip-allocator.ts`

`allocateTunnelPort` 增加 `blacklist` 参数：

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
  return csv.split(",")
    .map((s) => parseInt(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}
```

**文件**: `src/app/api/lines/route.ts`

调用 allocator 前合并两端节点的黑名单：

```typescript
const fromBL = parseTunnelPortBlacklist(fromNode.tunnelPortBlacklist);
const toBL = parseTunnelPortBlacklist(toNode.tunnelPortBlacklist);
const combined = new Set([...fromBL, ...toBL]);
const fromPort = allocateTunnelPort(usedPorts, tunnelPortStart, combined);
// 注意：先把 fromPort 加入 usedPorts 再分配 toPort
```

### 3. Agent 扩展上报：包含 wm-tun* 状态

**文件**: `agent/api/status.go`

`StatusReport` 加新字段：

```go
TunnelStatuses []TunnelStatusReport `json:"tunnel_statuses,omitempty"`

type TunnelStatusReport struct {
    Iface         string `json:"iface"`           // wm-tun11 等
    PeerPublicKey string `json:"peer_public_key"`
    LastHandshake int64  `json:"last_handshake"`  // unix seconds, 0 = 从未
    RxBytes       int64  `json:"rx_bytes"`
    TxBytes       int64  `json:"tx_bytes"`
}
```

**文件**: `agent/collector/collector.go`

在现有 `Collect()` 函数里，除了原有的 `wm-wg0` 握手收集，增加对所有 `wm-tun*` 接口的扫描。**用 `wg show all dump`** 一次拉全所有接口的所有信息（per-peer pubkey、endpoint、latest-handshake、rx/tx、keepalive），比逐接口调用高效。

```go
func collectTunnelStatuses() ([]api.TunnelStatusReport, error) {
    // wg show all dump 输出格式：
    //   <iface>  <interface_line>            （每个接口第一行）
    //   <iface>  <peer_line>                 （每个 peer 一行）
    // peer_line: pubkey preshared endpoint allowed-ips latest-handshake rx tx keepalive
    output, err := wg.WgShowAllDump()
    if err != nil { return nil, err }
    
    var reports []api.TunnelStatusReport
    for _, line := range strings.Split(output, "\n") {
        fields := strings.Split(line, "\t")
        iface := fields[0]
        if !strings.HasPrefix(iface, "wm-tun") { continue }
        if len(fields) < 9 { continue } // 跳过 interface 行（字段较少）
        // 解析 peer 行
        reports = append(reports, api.TunnelStatusReport{
            Iface:         iface,
            PeerPublicKey: fields[1],
            LastHandshake: parseInt64(fields[5]),
            RxBytes:       parseInt64(fields[6]),
            TxBytes:       parseInt64(fields[7]),
        })
    }
    return reports, nil
}
```

**文件**: `agent/wg/exec.go` 加封装：

```go
func WgShowAllDump() (string, error) {
    out, err := exec.Command("wg", "show", "all", "dump").Output()
    return string(out), err
}
```

### 4. 平台内存缓存

**新文件**: `src/lib/tunnel-status-cache.ts`

进程内 Map，按 nodeId 存最近一次 snapshot：

```typescript
type NodeSnapshot = {
  reportedAt: number;  // unix seconds, 平台收到时刻
  tunnels: TunnelStatusReport[];
};

const cache = new Map<number, NodeSnapshot>();

export function setNodeSnapshot(nodeId: number, tunnels: TunnelStatusReport[]) {
  cache.set(nodeId, { reportedAt: Math.floor(Date.now() / 1000), tunnels });
}

export function getNodeSnapshot(nodeId: number): NodeSnapshot | null {
  return cache.get(nodeId) ?? null;
}
```

**单进程假设**：Next.js 单进程部署够用。多副本场景需换共享缓存（Redis），现阶段不考虑。文件头注释里明确标注。

**文件**: `src/app/api/agent/status/route.ts`

收到 status report 后，把 `tunnel_statuses` 写入缓存：

```typescript
if (body.tunnel_statuses?.length) {
  setNodeSnapshot(node.id, body.tunnel_statuses);
}
```

不写库，不做健康判定。

### 5. 刷新机制：SSE 触发立即上报（不需要 RequestId）

#### 5.1 SSE 事件

**文件**: `src/lib/sse-manager.ts`

加一个事件类型 `request_status_report`，data 为空对象 `{}`。复用现有 `sseManager.sendEvent(nodeId, "request_status_report", {})`。

#### 5.2 Agent 端处理

**文件**: `agent/agent/agent.go`

在事件 dispatch（lines 91-115）加 case：

```go
case "request_status_report":
    a.collector.Collect()  // 立即触发一次 collect + report
```

agent 走**现有的 `POST /api/agent/status` 上报路径**，无需新协议。

#### 5.3 平台编排

**新文件**: `src/app/api/lines/[id]/tunnels/route.ts`

```typescript
// GET：直接读内存返回（数据可能 ≤30 秒前）
export async function GET(_req: NextRequest, { params }: { params: { id: string }}) {
  const lineId = parseInt(params.id);
  const tunnels = db.select().from(lineTunnels).where(eq(lineTunnels.lineId, lineId)).all();
  return Response.json(buildTunnelView(tunnels));
}
```

**新文件**: `src/app/api/lines/[id]/tunnels/refresh/route.ts`

```typescript
// POST：SSE 触发 + 短等待 + 返回最新数据
export async function POST(_req: NextRequest, { params }: { params: { id: string }}) {
  const lineId = parseInt(params.id);
  const tunnels = db.select().from(lineTunnels).where(eq(lineTunnels.lineId, lineId)).all();
  
  // 收集涉及的所有节点
  const nodeIds = new Set<number>();
  for (const t of tunnels) { nodeIds.add(t.fromNodeId); nodeIds.add(t.toNodeId); }
  
  // 并发发 SSE 通知
  for (const nodeId of nodeIds) {
    sseManager.sendEvent(nodeId, "request_status_report", {});
  }
  
  // 给 agent 一点时间收到事件 + collect + 上报
  await new Promise((r) => setTimeout(r, 1500));
  
  // 读最新缓存返回
  return Response.json(buildTunnelView(tunnels));
}
```

**`buildTunnelView` 拼装逻辑**：对每条 tunnel：
- 从 `setNodeSnapshot` 缓存里查 from / to 两端的 `wm-tun{tunnel.id}` 报告
- 取**较新的握手时间**作为 `lastHandshake`
- rx/tx 取**起点节点视角**；起点缺数据则用终点的反向值（rx ↔ tx），并标记 `dataFromToNode: true`
- `lastReportedAt`：两端 reportedAt 中**较旧**的（worst-case staleness）

返回 JSON：

```json
{
  "lineId": 6,
  "lastReportedAt": 1777111630,
  "tunnels": [
    {
      "id": 11,
      "lineId": 6,
      "hopIndex": 1,
      "fromNodeId": 5, "fromNodeName": "WireMesh-A",
      "toNodeId": 6,   "toNodeName": "WireMesh-B",
      "fromWgAddress": "10.211.0.41/30", "toWgAddress": "10.211.0.42/30",
      "fromWgPort": 41834, "toWgPort": 41835,
      "lastHandshake": 0,
      "rxBytes": 0,
      "txBytes": 354100,
      "dataFromToNode": false,
      "stale": false  // 缓存 > 60 秒视为 stale
    }
  ]
}
```

### 6. 一键重新分配端口

**新文件**: `src/app/api/line-tunnels/[id]/reallocate/route.ts`

POST 接口，对指定 `line_tunnels` 行：

1. 读取 from/to 节点的当前黑名单
2. **把当前 from_wg_port、to_wg_port 自动加入对应节点的黑名单**——用户调用这个 API 的语义就是"这对端口有问题"
3. 用 allocator 重新分配新端口对（自动避开新黑名单）
4. 重新生成 wg 密钥对（fromWgPrivateKey/PublicKey、toWgPrivateKey/PublicKey）
5. UPDATE 该行的端口、密钥
6. bump 两端 `nodes.updated_at` 触发 SSE，agent 拉新配置时重建 `wm-tun*` 接口

不需要重建整条 line，不影响其他分支/隧道。

写审计日志：`action=reallocate_tunnel, target=line_tunnel:<id>, detail=old=41834/41835 new=41842/41843`

### 7. UI

**线路详情页** `src/app/(dashboard)/lines/[id]/page.tsx`：

「隧道信息」板块改造：

**标题栏**：
- 标题左侧不变：`隧道信息`
- 标题右侧加：`[🔄 刷新]`  `上次更新 12:34:05`
- 点击刷新 → 调 `POST /api/lines/:id/tunnels/refresh`，按钮转 spinner，~1.5 秒后表格更新 + toast "已刷新"

**表格**：在现有 7 列后追加 2 列，再加一列 "操作"：

| 段 | 起点节点 | 终点节点 | 起点地址 | 终点地址 | 起点端口 | 终点端口 | 最近握手 | 收发 | 操作 |
|----|---------|---------|---------|---------|---------|---------|---------|------|------|
| 1 | WireMesh-A | WireMesh-B | 10.211.0.41/30 | 10.211.0.42/30 | 20247 | 20248 | 12 秒前 | ↓2.3 GB ↑1.1 GB | — |
| 2 | WireMesh-B | WireMesh-C | ... | ... | 20249 | 20250 | 5 秒前 | ↓512 MB ↑280 MB | — |
| 3 | WireMesh-A | WireMesh-C | ... | ... | 20253 | 20254 | 从未 | ↓0 ↑358 KB | [重新分配] |

**列规则**：
- **最近握手**：相对时间（"12 秒前"、"5 分钟前"），从未握手显示 "从未"
- **收发**：人类可读单位，格式 "↓{rx} ↑{tx}"
- **操作**：仅当 `lastHandshake === 0`（从未握手）或 ≥5 分钟无握手时显示 [重新分配]，二次确认后调 reallocate API
- **stale 标记**：如果某行的数据缓存超过 60 秒，在"最近握手"列加灰色 ⓘ 图标，悬停提示"数据可能不新鲜，请点刷新"
- **agent 离线**：缓存里没该节点的数据时，"最近握手"和"收发"显示 "—"

**节点设置页** `src/app/(dashboard)/nodes/[id]/page.tsx`：

新增「隧道端口黑名单」字段，以 tag 形式展示，可点 ✕ 移除、可手动输入端口添加。保存到 `nodes.tunnel_port_blacklist`。

### 8. i18n

新增 keys（`messages/zh-CN.json` + `en.json`）：

| key | zh-CN | en |
|-----|-------|----|
| `tunnel.lastHandshake` | 最近握手 | Last handshake |
| `tunnel.transfer` | 收发 | Transfer |
| `tunnel.never` | 从未 | Never |
| `tunnel.refresh` | 刷新 | Refresh |
| `tunnel.refreshed` | 已刷新 | Refreshed |
| `tunnel.lastUpdated` | 上次更新 {time} | Last updated {time} |
| `tunnel.staleData` | 数据可能不新鲜，请点刷新 | Data may be stale, click refresh |
| `tunnel.reallocate` | 重新分配端口 | Reallocate ports |
| `tunnel.reallocateConfirm` | 当前端口 {ports} 将加入节点黑名单，是否继续？ | Current ports {ports} will be added to node blacklist. Continue? |
| `tunnel.actions` | 操作 | Actions |
| `node.tunnelPortBlacklist` | 隧道端口黑名单 | Tunnel port blacklist |

## 不需要改动的地方

| 位置 | 原因 |
|------|------|
| Agent 上报协议 (`agent/api/status.go`) | 仅追加字段，向后兼容 |
| 现有 `Handshakes` 字段（设备 wg 握手） | 与隧道握手互不干扰，保留不动 |
| Agent 隧道创建 (`agent/wg/`) | agent 拉新配置时已能根据端口变化重建接口 |
| Xray / SOCKS5 / 设备配置 | 与隧道运行状态无关 |
| `tunnel_port_start` 全局设置 | 仍保留——黑名单是节点局部排除，全局起始点是别的语义 |
| `line_tunnels` 表结构 | 状态完全实时不持久化，不需要新字段 |

## 决策记录

- **黑名单为什么是节点级而非全局**：不同云厂商对端口的处理不一样，节点维度最自然。allocator 取两端并集即可覆盖任意非对称情况。
- **为什么完全去掉自动健康判定 / 状态徽章**：单管理员场景下，自动判定容易引入误判（临时网络抖动被误判为坏端口而污染数据），代价大于收益。让管理员看原始数据（"5 分钟前 / 从未"）+ 自己判断，更可靠也更可控。
- **为什么内存缓存而不是 SSE-RPC**：SSE-RPC（请求 ID + Promise + 反向端点）需要写 ~200 行新代码，引入 stateful 协议层。复用 agent 已有 status report 通道 + 单向 SSE 触发，仅需 ~50 行，agent 反向走现有 `/api/agent/status`。新鲜度差几百毫秒，但代价低 4 倍。
- **为什么不持久化 `last_handshake_at`**：状态是运行时事实，agent 每次 collect 都拿到真实值；存库会引入"DB 值过期 vs agent 实时值不一致"的同步问题，且无人需要查询历史握手时间。
- **reallocate 为什么自动把旧端口加黑名单**：用户调用这个 API 的语义就是"这对端口有问题"，不加黑名单则下一次 allocator 会再次分到同一对端口。这是符合用户意图的隐式行为。
- **多进程部署限制**：内存缓存是进程内状态，假设单进程部署。若未来转 K8s 多副本，需要换成 Redis 或类似的共享缓存——`tunnel-status-cache.ts` 文件头注释里明确这个 TODO。
- **`wg show all dump` 一次性拉全**：避免按接口逐个 exec，N 个隧道接口只 1 次进程调用，资源占用极低。

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/db/schema.ts` | 加 `nodes.tunnelPortBlacklist` 字段 |
| `drizzle/0011_node_port_blacklist.sql` | 新建 migration |
| `src/lib/ip-allocator.ts` | 加 blacklist 参数 + parseTunnelPortBlacklist |
| `src/app/api/lines/route.ts` | 调 allocator 时传黑名单 |
| `src/lib/tunnel-status-cache.ts` | 新建：内存缓存 |
| `src/app/api/agent/status/route.ts` | 收到 tunnel_statuses 后写缓存 |
| `src/app/api/lines/[id]/tunnels/route.ts` | 新建：GET 返回拼装数据 |
| `src/app/api/lines/[id]/tunnels/refresh/route.ts` | 新建：POST 触发 SSE + 等待 + 返回 |
| `src/app/api/line-tunnels/[id]/reallocate/route.ts` | 新建：一键重新分配端口（含自动加黑名单） |
| `agent/api/status.go` | StatusReport 加 TunnelStatuses 字段 |
| `agent/wg/exec.go` | 加 WgShowAllDump 封装 |
| `agent/collector/collector.go` | Collect 时收集 wm-tun* 状态 |
| `agent/agent/agent.go` | 事件 dispatch 加 `request_status_report` case |
| `src/app/(dashboard)/lines/[id]/page.tsx` | 隧道信息板块加两列 + 刷新按钮 + 重新分配按钮 |
| `src/app/(dashboard)/nodes/[id]/page.tsx` | 节点黑名单管理 UI |
| `messages/zh-CN.json` + `messages/en.json` | i18n |
