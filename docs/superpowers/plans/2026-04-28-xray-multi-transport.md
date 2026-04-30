# Xray 多传输并存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一个节点能同时提供 Reality 与 WebSocket+TLS 两种 Xray 入站，由设备的 `protocol` 直接选择消费哪一种；引入 `node_protocols` / `line_protocols` 关联表统一管理协议启用状态与端口。

**Architecture:** 关联表 `node_protocols(node_id, protocol, config)` 与 `line_protocols(line_id, protocol, port)` 替代散落在 nodes/lines 上的 Xray/SOCKS5 字段。设备 `protocol` 枚举从 `wireguard|xray|socks5` 扩为 `wireguard|xray-reality|xray-wstls|socks5`。Agent 协议改为 `XrayConfig.Inbounds[]`，每个 (line, transport) 一项。无数据迁移（dev DB 重置）。

**Tech Stack:** Next.js 16 + React 19、Drizzle ORM + better-sqlite3、shadcn/ui Tabs、next-intl、Vitest（TS）+ Go testing（Agent）。

**Spec:** `docs/superpowers/specs/2026-04-28-xray-multi-transport-design.md`

---

## File Structure

### 新增文件

| 路径 | 职责 |
|---|---|
| `src/lib/protocols.ts` | 协议枚举常量、transport ↔ device-protocol 映射、协议判定纯函数 |
| `src/lib/db/protocols.ts` | `node_protocols` / `line_protocols` 的 CRUD 与懒分配/回收逻辑 |
| `__tests__/lib/protocols.test.ts` | 协议映射函数单测 |
| `__tests__/lib/db/protocols.test.ts` | 关联表 helper 单测（用 in-memory better-sqlite3） |
| `drizzle/0013_xray_multi_transport.sql` | 自动生成的 schema 迁移 |

### 修改文件

**Schema/DB**
- `src/lib/db/schema.ts` — 移除 nodes/lines 上的 xray/socks5 字段；新增两个 sqliteTable 定义

**Server APIs**
- `src/app/api/nodes/route.ts`、`src/app/api/nodes/[id]/route.ts`
- `src/app/api/devices/route.ts`、`src/app/api/devices/[id]/route.ts`、`src/app/api/devices/[id]/line/route.ts`、`src/app/api/devices/[id]/config/route.ts`
- `src/app/api/agent/config/route.ts`

**Subscription**
- `src/lib/subscription/types.ts`、`src/lib/subscription/load-device-context.ts`
- `src/lib/subscription/clash-builder.ts`、`singbox-builder.ts`、`uri-builders.ts`、`v2ray-builder.ts`、`shadowrocket-builder.ts`、`formats.ts`
- 对应的 5 个 `__tests__/lib/subscription/*-builder.test.ts` + `formats.test.ts`

**UI**
- `src/app/(dashboard)/nodes/new/page.tsx`、`src/app/(dashboard)/nodes/[id]/page.tsx`
- `src/app/(dashboard)/devices/new/page.tsx`、`src/app/(dashboard)/devices/[id]/page.tsx`、`src/app/(dashboard)/devices/page.tsx`
- `src/components/node-ports-detail.tsx`

**i18n**
- `messages/zh-CN.json`、`messages/en.json`

**Agent**
- `agent/api/config_types.go`、`agent/xray/config.go`、`agent/xray/config_test.go`

---

## Phase 1 — 数据模型与基础工具

### Task 1: 创建协议枚举模块

**Files:**
- Create: `src/lib/protocols.ts`
- Create: `__tests__/lib/protocols.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/protocols.test.ts
import { describe, it, expect } from "vitest";
import {
  DEVICE_PROTOCOLS,
  isXrayProtocol,
  deviceProtocolToTransport,
  transportToDeviceProtocol,
} from "@/lib/protocols";

describe("protocols", () => {
  it("DEVICE_PROTOCOLS contains the four expected values", () => {
    expect(DEVICE_PROTOCOLS).toEqual([
      "wireguard",
      "xray-reality",
      "xray-wstls",
      "socks5",
    ]);
  });

  it("isXrayProtocol identifies xray-reality and xray-wstls", () => {
    expect(isXrayProtocol("xray-reality")).toBe(true);
    expect(isXrayProtocol("xray-wstls")).toBe(true);
    expect(isXrayProtocol("wireguard")).toBe(false);
    expect(isXrayProtocol("socks5")).toBe(false);
  });

  it("deviceProtocolToTransport maps to agent transport values", () => {
    expect(deviceProtocolToTransport("xray-reality")).toBe("reality");
    expect(deviceProtocolToTransport("xray-wstls")).toBe("ws-tls");
    expect(deviceProtocolToTransport("wireguard")).toBeNull();
    expect(deviceProtocolToTransport("socks5")).toBeNull();
  });

  it("transportToDeviceProtocol is the inverse for xray", () => {
    expect(transportToDeviceProtocol("reality")).toBe("xray-reality");
    expect(transportToDeviceProtocol("ws-tls")).toBe("xray-wstls");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/protocols.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```typescript
// src/lib/protocols.ts
export const DEVICE_PROTOCOLS = [
  "wireguard",
  "xray-reality",
  "xray-wstls",
  "socks5",
] as const;

export type DeviceProtocol = (typeof DEVICE_PROTOCOLS)[number];
export type XrayTransport = "reality" | "ws-tls";

export function isXrayProtocol(p: string): p is "xray-reality" | "xray-wstls" {
  return p === "xray-reality" || p === "xray-wstls";
}

export function deviceProtocolToTransport(p: DeviceProtocol): XrayTransport | null {
  if (p === "xray-reality") return "reality";
  if (p === "xray-wstls") return "ws-tls";
  return null;
}

export function transportToDeviceProtocol(t: XrayTransport): "xray-reality" | "xray-wstls" {
  return t === "reality" ? "xray-reality" : "xray-wstls";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/lib/protocols.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/protocols.ts __tests__/lib/protocols.test.ts
git commit -m "feat(protocols): add device-protocol enum + transport mapping helpers"
```

---

### Task 2: 更新 Drizzle schema —— 新增关联表、移除旧字段

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Replace `nodes` table definition (lines 31-60)** —— 删除 8 个 xray/tls 字段：

```typescript
// ===== nodes =====
export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  domain: text("domain"),
  port: integer("port").notNull().default(51820),
  agentToken: text("agent_token").notNull().unique(),
  wgPrivateKey: text("wg_private_key").notNull(),
  wgPublicKey: text("wg_public_key").notNull(),
  wgAddress: text("wg_address").notNull(),
  externalInterface: text("external_interface").notNull().default("eth0"),
  status: text("status").notNull().default("offline"),
  errorMessage: text("error_message"),
  agentVersion: text("agent_version"),
  xrayVersion: text("xray_version"),
  upgradeTriggeredAt: text("upgrade_triggered_at"),
  xrayUpgradeTriggeredAt: text("xray_upgrade_triggered_at"),
  pendingDelete: integer("pending_delete", { mode: "boolean" }).notNull().default(false),
  tunnelPortBlacklist: text("tunnel_port_blacklist").notNull().default(""),
  remark: text("remark"),
  ...timestamps,
});
```

- [ ] **Step 2: Replace `lines` table definition (lines 76-84)** —— 删除 `xrayPort` 和 `socks5Port`：

```typescript
// ===== lines =====
export const lines = sqliteTable("lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  remark: text("remark"),
  ...timestamps,
});
```

- [ ] **Step 3: Append new tables after `subscriptionGroupDevices` (~line 188)**:

```typescript
// ===== node_protocols =====
export const nodeProtocols = sqliteTable("node_protocols", {
  nodeId: integer("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  protocol: text("protocol").notNull(),
  config: text("config").notNull().default("{}"),
  ...timestamps,
}, (t) => ({
  pk: { columns: [t.nodeId, t.protocol], name: "pk" },
}));

// ===== line_protocols =====
export const lineProtocols = sqliteTable("line_protocols", {
  lineId: integer("line_id").notNull().references(() => lines.id, { onDelete: "cascade" }),
  protocol: text("protocol").notNull(),
  port: integer("port"),
  config: text("config").notNull().default("{}"),
  ...timestamps,
}, (t) => ({
  pk: { columns: [t.lineId, t.protocol], name: "pk" },
}));
```

Note: drizzle-kit's sqlite `primaryKey` helper is invoked via the second-arg config object. If `pk` shape doesn't compile, use `import { primaryKey } from "drizzle-orm/sqlite-core";` and write `pk: primaryKey({ columns: [t.nodeId, t.protocol] })`. Check existing usages in the file first.

- [ ] **Step 4: Generate migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0013_<auto_name>.sql`. Inspect the generated SQL — should contain:
- `ALTER TABLE nodes DROP COLUMN xray_protocol` (×8 columns)
- `ALTER TABLE lines DROP COLUMN xray_port`、`DROP COLUMN socks5_port`
- `CREATE TABLE node_protocols (...)`、`CREATE TABLE line_protocols (...)`

If drizzle generates an unwanted recreation of unrelated tables, manually clean it up.

- [ ] **Step 5: Reset dev DB and apply migrations**

```bash
rm -f data/wiremesh.db
npm run dev
```

Wait for the migration runner to finish (see logs); then Ctrl+C the dev server. (We'll verify in later phases.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0013_*.sql drizzle/meta/
git commit -m "feat(db): add node_protocols/line_protocols tables, drop legacy xray fields"
```

---

### Task 3: 关联表 helper —— `node_protocols` CRUD

**Files:**
- Create: `src/lib/db/protocols.ts`
- Create: `__tests__/lib/db/protocols.test.ts`

- [ ] **Step 1: Write the failing test (focus on node-level operations)**

```typescript
// __tests__/lib/db/protocols.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nodes, lines, devices, nodeProtocols, lineProtocols } from "@/lib/db/schema";
import {
  enableNodeProtocol,
  disableNodeProtocol,
  getNodeProtocols,
  setNodeProtocolConfig,
} from "@/lib/db/protocols";

let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("node_protocols helpers", () => {
  it("enableNodeProtocol creates a row with config JSON", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();

    enableNodeProtocol(db, node.id, "xray-reality", { realityDest: "www.x.com:443" });

    const rows = getNodeProtocols(db, node.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].protocol).toBe("xray-reality");
    expect(JSON.parse(rows[0].config)).toEqual({ realityDest: "www.x.com:443" });
  });

  it("setNodeProtocolConfig updates an existing row", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    enableNodeProtocol(db, node.id, "xray-reality", { realityDest: "old:443" });

    setNodeProtocolConfig(db, node.id, "xray-reality", { realityDest: "new:443" });

    const cfg = JSON.parse(getNodeProtocols(db, node.id)[0].config);
    expect(cfg.realityDest).toBe("new:443");
  });

  it("disableNodeProtocol removes the row", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    enableNodeProtocol(db, node.id, "xray-wstls", { tlsDomain: "x.com" });

    disableNodeProtocol(db, node.id, "xray-wstls");

    expect(getNodeProtocols(db, node.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- __tests__/lib/db/protocols.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper module (node operations)**

```typescript
// src/lib/db/protocols.ts
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { nodeProtocols, lineProtocols } from "@/lib/db/schema";
import type { DeviceProtocol } from "@/lib/protocols";

type DB = BetterSQLite3Database<Record<string, unknown>>;

export function getNodeProtocols(db: DB, nodeId: number) {
  return db.select().from(nodeProtocols).where(eq(nodeProtocols.nodeId, nodeId)).all();
}

export function getNodeProtocol(db: DB, nodeId: number, protocol: DeviceProtocol) {
  return db.select().from(nodeProtocols)
    .where(and(eq(nodeProtocols.nodeId, nodeId), eq(nodeProtocols.protocol, protocol)))
    .get();
}

export function enableNodeProtocol(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
  config: Record<string, unknown>,
) {
  db.insert(nodeProtocols)
    .values({ nodeId, protocol, config: JSON.stringify(config) })
    .run();
}

export function setNodeProtocolConfig(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
  config: Record<string, unknown>,
) {
  db.update(nodeProtocols)
    .set({ config: JSON.stringify(config), updatedAt: new Date().toISOString() })
    .where(and(eq(nodeProtocols.nodeId, nodeId), eq(nodeProtocols.protocol, protocol)))
    .run();
}

export function disableNodeProtocol(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
) {
  db.delete(nodeProtocols)
    .where(and(eq(nodeProtocols.nodeId, nodeId), eq(nodeProtocols.protocol, protocol)))
    .run();
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- __tests__/lib/db/protocols.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/protocols.ts __tests__/lib/db/protocols.test.ts
git commit -m "feat(db/protocols): node_protocols CRUD helpers"
```

---

### Task 4: 关联表 helper —— `line_protocols` 懒分配/回收

**Files:**
- Modify: `src/lib/db/protocols.ts`
- Modify: `__tests__/lib/db/protocols.test.ts`

- [ ] **Step 1: Append failing tests for line-level operations**

```typescript
// at the bottom of __tests__/lib/db/protocols.test.ts
import { ensureLineProtocol, releaseLineProtocol } from "@/lib/db/protocols";

describe("line_protocols helpers", () => {
  it("ensureLineProtocol allocates a port for first call", () => {
    const line = db.insert(lines).values({ name: "L1" }).returning().get();
    const port = ensureLineProtocol(db, line.id, "xray-reality", { startPort: 41443 });
    expect(port).toBe(41443);

    const rows = db.select().from(lineProtocols).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].port).toBe(41443);
  });

  it("ensureLineProtocol skips ports in use across the same protocol", () => {
    const a = db.insert(lines).values({ name: "A" }).returning().get();
    const b = db.insert(lines).values({ name: "B" }).returning().get();
    expect(ensureLineProtocol(db, a.id, "xray-reality", { startPort: 41443 })).toBe(41443);
    expect(ensureLineProtocol(db, b.id, "xray-reality", { startPort: 41443 })).toBe(41444);
  });

  it("ensureLineProtocol allows same port for different protocols on different lines", () => {
    const a = db.insert(lines).values({ name: "A" }).returning().get();
    const b = db.insert(lines).values({ name: "B" }).returning().get();
    expect(ensureLineProtocol(db, a.id, "xray-reality", { startPort: 41443 })).toBe(41443);
    expect(ensureLineProtocol(db, b.id, "socks5", { startPort: 41443 })).toBe(41443);
  });

  it("ensureLineProtocol returns existing port on subsequent calls", () => {
    const l = db.insert(lines).values({ name: "L" }).returning().get();
    const p1 = ensureLineProtocol(db, l.id, "socks5", { startPort: 41443 });
    const p2 = ensureLineProtocol(db, l.id, "socks5", { startPort: 41443 });
    expect(p1).toBe(p2);
  });

  it("ensureLineProtocol does not allocate a port for wireguard", () => {
    const l = db.insert(lines).values({ name: "L" }).returning().get();
    const port = ensureLineProtocol(db, l.id, "wireguard", { startPort: 41443 });
    expect(port).toBeNull();
    expect(db.select().from(lineProtocols).all()).toHaveLength(1);
  });

  it("releaseLineProtocol removes the row", () => {
    const l = db.insert(lines).values({ name: "L" }).returning().get();
    ensureLineProtocol(db, l.id, "xray-wstls", { startPort: 41443 });
    releaseLineProtocol(db, l.id, "xray-wstls");
    expect(db.select().from(lineProtocols).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- __tests__/lib/db/protocols.test.ts`
Expected: FAIL — `ensureLineProtocol` not defined.

- [ ] **Step 3: Append implementation**

```typescript
// in src/lib/db/protocols.ts
export function ensureLineProtocol(
  db: DB,
  lineId: number,
  protocol: DeviceProtocol,
  opts: { startPort: number },
): number | null {
  const existing = db.select().from(lineProtocols)
    .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, protocol)))
    .get();
  if (existing) return existing.port ?? null;

  const allocatePort = protocol !== "wireguard";
  let port: number | null = null;
  if (allocatePort) {
    const usedRows = db.select({ port: lineProtocols.port }).from(lineProtocols)
      .where(eq(lineProtocols.protocol, protocol))
      .all();
    const used = new Set(usedRows.map(r => r.port).filter((p): p is number => p !== null));
    let candidate = opts.startPort;
    while (used.has(candidate)) candidate++;
    port = candidate;
  }

  db.insert(lineProtocols)
    .values({ lineId, protocol, port })
    .run();
  return port;
}

export function releaseLineProtocol(
  db: DB,
  lineId: number,
  protocol: DeviceProtocol,
) {
  db.delete(lineProtocols)
    .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, protocol)))
    .run();
}

export function getLineProtocols(db: DB, lineId: number) {
  return db.select().from(lineProtocols).where(eq(lineProtocols.lineId, lineId)).all();
}

export function getLineProtocolPort(
  db: DB,
  lineId: number,
  protocol: DeviceProtocol,
): number | null {
  const row = db.select({ port: lineProtocols.port }).from(lineProtocols)
    .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, protocol)))
    .get();
  return row?.port ?? null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- __tests__/lib/db/protocols.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/protocols.ts __tests__/lib/db/protocols.test.ts
git commit -m "feat(db/protocols): lazy line-protocol allocation/release helpers"
```

---

### Task 5: 兼容性校验 helper —— 设备 protocol vs 节点支持的协议

**Files:**
- Modify: `src/lib/db/protocols.ts`
- Modify: `__tests__/lib/db/protocols.test.ts`

- [ ] **Step 1: Append failing test**

```typescript
import { isProtocolSupportedByEntryNode, getEntryNodeIdForLine } from "@/lib/db/protocols";

describe("compatibility checks", () => {
  it("isProtocolSupportedByEntryNode returns true when row exists", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    enableNodeProtocol(db, node.id, "xray-wstls", { tlsDomain: "x.com" });
    expect(isProtocolSupportedByEntryNode(db, node.id, "xray-wstls")).toBe(true);
    expect(isProtocolSupportedByEntryNode(db, node.id, "xray-reality")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- __tests__/lib/db/protocols.test.ts`

- [ ] **Step 3: Implement**

```typescript
// in src/lib/db/protocols.ts
import { lineNodes } from "@/lib/db/schema";

export function isProtocolSupportedByEntryNode(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
): boolean {
  const row = getNodeProtocol(db, nodeId, protocol);
  return row != null;
}

export function getEntryNodeIdForLine(db: DB, lineId: number): number | null {
  const row = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry")))
    .get();
  return row?.nodeId ?? null;
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(db/protocols): protocol compatibility helpers"
```

---

### Task 6: 工具 —— 默认 xray 端口读取

**Files:**
- Modify: `src/lib/db/protocols.ts`

- [ ] **Step 1: Append helper without test (the test would just mirror the SQL)**

```typescript
// in src/lib/db/protocols.ts
import { settings } from "@/lib/db/schema";

const DEFAULT_XRAY_BASE_PORT = 41443;

export function getDefaultProxyBasePort(db: DB): number {
  const row = db.select().from(settings).where(eq(settings.key, "xray_default_port")).get();
  if (!row) return DEFAULT_XRAY_BASE_PORT;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_XRAY_BASE_PORT;
}
```

- [ ] **Step 2: Smoke check the imports compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (or only pre-existing errors elsewhere).

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(db/protocols): expose getDefaultProxyBasePort"
```

---

## Phase 2 — Agent 协议与 server-side 装配

### Task 7: 重写 `agent/api/config_types.go` 中的 Xray 段

**Files:**
- Modify: `agent/api/config_types.go`

- [ ] **Step 1: Find the existing `XrayConfig` struct and replace it**

Replace the entire `XrayConfig` (and any helper types like `XrayLineRoute`) with:

```go
// XrayConfig is delivered per-node by the platform.
type XrayConfig struct {
    Enabled  bool          `json:"enabled"`
    Inbounds []XrayInbound `json:"inbounds"`
    DNSProxy string        `json:"dnsProxy,omitempty"`
}

// XrayInbound describes one (line, transport) listener.
type XrayInbound struct {
    LineID    int    `json:"lineId"`
    Transport string `json:"transport"` // "reality" | "ws-tls"
    Protocol  string `json:"protocol"`  // "vless"
    Port      int    `json:"port"`

    // reality fields
    RealityPrivateKey  string   `json:"realityPrivateKey,omitempty"`
    RealityShortId     string   `json:"realityShortId,omitempty"`
    RealityDest        string   `json:"realityDest,omitempty"`
    RealityServerNames []string `json:"realityServerNames,omitempty"`

    // ws-tls fields
    WsPath    string `json:"wsPath,omitempty"`
    TlsDomain string `json:"tlsDomain,omitempty"`
    TlsCert   string `json:"tlsCert,omitempty"`
    TlsKey    string `json:"tlsKey,omitempty"`

    // routing
    UUIDs    []string         `json:"uuids"`
    Mark     int              `json:"mark"`
    Tunnel   string           `json:"tunnel"`
    Branches []XrayLineBranch `json:"branches"`
}

type XrayLineBranch struct {
    Mark        int      `json:"mark"`
    Tunnel      string   `json:"tunnel"`
    IsDefault   bool     `json:"is_default"`
    DomainRules []string `json:"domain_rules"`
}
```

If `XrayLineBranch` is defined elsewhere with the same shape, leave that copy and remove the duplicate here. Adjust imports.

- [ ] **Step 2: Build the agent**

Run: `cd agent && go build ./...`
Expected: failures in `agent/xray/config.go` referencing removed top-level fields. We'll fix that next.

- [ ] **Step 3: Commit**

```bash
git add agent/api/config_types.go
git commit -m "feat(agent/api): replace flat XrayConfig with Inbounds[] schema"
```

---

### Task 8: 重写 `agent/xray/config.go` 以遍历 Inbounds

**Files:**
- Modify: `agent/xray/config.go`

- [ ] **Step 1: Identify the loop**

Open `agent/xray/config.go`. The current `GenerateConfig(cfg *api.XrayConfig)` iterates `cfg.Routes`. Replace that loop's body so that:

- Each `XrayInbound` produces one inbound + one outbound + one routing rule
- Inbound tag: `fmt.Sprintf("in-line-%d-%s", inb.LineID, inb.Transport)`
- Outbound tag: `fmt.Sprintf("out-line-%d-%s", inb.LineID, inb.Transport)`
- `streamSettings` is selected by `inb.Transport`:
  - `"reality"` → reality streamSettings with `inb.RealityPrivateKey`/`ShortId`/`Dest`/`ServerNames`
  - `"ws-tls"` → ws+tls streamSettings with `inb.WsPath`/`TlsDomain` and certificate paths derived from `TlsDomain`
- `flow` field on clients only set for `Transport == "reality"`
- Skip the inbound entirely if `len(inb.UUIDs) == 0` (defensive against orphan rows)

Reference: the spec's "Agent 协议变更" section and the existing single-transport implementation. Keep the surrounding stats/api/policy/log boilerplate untouched.

- [ ] **Step 2: Replace the route-iteration block** with:

```go
for _, inb := range cfg.Inbounds {
    if len(inb.UUIDs) == 0 {
        continue
    }
    inboundTag := fmt.Sprintf("in-line-%d-%s", inb.LineID, inb.Transport)
    outboundTag := fmt.Sprintf("out-line-%d-%s", inb.LineID, inb.Transport)

    var clients []map[string]interface{}
    for _, uuid := range inb.UUIDs {
        client := map[string]interface{}{"id": uuid, "email": uuid, "level": 0}
        if inb.Transport == "reality" {
            client["flow"] = "xtls-rprx-vision"
        }
        clients = append(clients, client)
    }

    var streamSettings map[string]interface{}
    if inb.Transport == "ws-tls" {
        streamSettings = map[string]interface{}{
            "network":  "ws",
            "security": "tls",
            "wsSettings": map[string]interface{}{"path": inb.WsPath},
            "tlsSettings": map[string]interface{}{
                "certificates": []map[string]interface{}{{
                    "certificateFile": fmt.Sprintf("/etc/wiremesh/xray/%s.crt", inb.TlsDomain),
                    "keyFile":         fmt.Sprintf("/etc/wiremesh/xray/%s.key", inb.TlsDomain),
                }},
                "serverName": inb.TlsDomain,
            },
        }
    } else {
        streamSettings = map[string]interface{}{
            "network":  "tcp",
            "security": "reality",
            "realitySettings": map[string]interface{}{
                "show":        false,
                "dest":        inb.RealityDest,
                "xver":        0,
                "serverNames": inb.RealityServerNames,
                "privateKey":  inb.RealityPrivateKey,
                "shortIds":    []string{inb.RealityShortId},
            },
        }
    }

    inbounds = append(inbounds, map[string]interface{}{
        "tag": inboundTag, "listen": "0.0.0.0", "port": inb.Port, "protocol": inb.Protocol,
        "settings":       map[string]interface{}{"clients": clients, "decryption": "none"},
        "sniffing":       map[string]interface{}{"enabled": true, "destOverride": []string{"http", "tls"}},
        "streamSettings": streamSettings,
    })

    outbounds = append(outbounds, map[string]interface{}{
        "protocol": "freedom", "tag": outboundTag,
        "settings":       map[string]interface{}{"domainStrategy": "UseIP"},
        "streamSettings": map[string]interface{}{"sockopt": map[string]interface{}{"mark": inb.Mark}},
    })

    routingRules = append(routingRules, map[string]interface{}{
        "type": "field", "inboundTag": []string{inboundTag}, "outboundTag": outboundTag,
    })

    // Branch handling: same pattern as before, but iterate inb.Branches
    // ... reuse the existing branch logic, simply replacing route. with inb.
}
```

- [ ] **Step 3: Build and run existing test**

Run: `cd agent && go build ./... && go test ./xray/...`
Expected: existing `TestGenerateConfig_StatsAndAPI` is failing because it constructs the old `XrayConfig{Routes: ...}` shape — that's expected and will be fixed in the next task.

- [ ] **Step 4: Commit**

```bash
git add agent/xray/config.go
git commit -m "refactor(agent/xray): iterate XrayInbounds[] for per-(line,transport) inbounds"
```

---

### Task 9: 重写 `agent/xray/config_test.go` 以使用新协议

**Files:**
- Modify: `agent/xray/config_test.go`

- [ ] **Step 1: Replace existing tests with new tests covering both transports**

Replace test bodies that use `Routes:` to use `Inbounds:`. Key tests to keep/add:

```go
func TestGenerateConfig_RealityInbound(t *testing.T) {
    cfg := &api.XrayConfig{
        Enabled: true,
        Inbounds: []api.XrayInbound{{
            LineID:             1,
            Transport:          "reality",
            Protocol:           "vless",
            Port:               41443,
            RealityPrivateKey:  "priv",
            RealityShortId:     "abcd",
            RealityDest:        "www.x.com:443",
            RealityServerNames: []string{"www.x.com"},
            UUIDs:              []string{"u1", "u2"},
            Mark:               100,
        }},
    }
    data, err := GenerateConfig(cfg)
    if err != nil { t.Fatal(err) }
    var r map[string]interface{}
    _ = json.Unmarshal(data, &r)
    inb := findInboundByTag(r, "in-line-1-reality")
    if inb == nil { t.Fatal("missing reality inbound") }
    ss := inb["streamSettings"].(map[string]interface{})
    if ss["security"] != "reality" { t.Errorf("want security=reality, got %v", ss["security"]) }
}

func TestGenerateConfig_WsTlsInbound(t *testing.T) {
    cfg := &api.XrayConfig{
        Enabled: true,
        Inbounds: []api.XrayInbound{{
            LineID:    1,
            Transport: "ws-tls",
            Protocol:  "vless",
            Port:      41444,
            WsPath:    "/abc",
            TlsDomain: "node.example.com",
            UUIDs:     []string{"u3"},
            Mark:      101,
        }},
    }
    data, err := GenerateConfig(cfg)
    if err != nil { t.Fatal(err) }
    var r map[string]interface{}
    _ = json.Unmarshal(data, &r)
    inb := findInboundByTag(r, "in-line-1-ws-tls")
    if inb == nil { t.Fatal("missing ws-tls inbound") }
    ss := inb["streamSettings"].(map[string]interface{})
    if ss["network"] != "ws" || ss["security"] != "tls" {
        t.Errorf("want ws/tls, got %v/%v", ss["network"], ss["security"])
    }
}

func TestGenerateConfig_BothTransportsForOneLine(t *testing.T) {
    cfg := &api.XrayConfig{
        Enabled: true,
        Inbounds: []api.XrayInbound{
            { LineID: 1, Transport: "reality", Protocol: "vless", Port: 41443,
                RealityPrivateKey: "k", RealityShortId: "id", RealityDest: "x:443",
                RealityServerNames: []string{"x"}, UUIDs: []string{"u1"}, Mark: 100 },
            { LineID: 1, Transport: "ws-tls",  Protocol: "vless", Port: 41444,
                WsPath: "/p", TlsDomain: "x", UUIDs: []string{"u2"}, Mark: 100 },
        },
    }
    data, err := GenerateConfig(cfg)
    if err != nil { t.Fatal(err) }
    var r map[string]interface{}
    _ = json.Unmarshal(data, &r)
    if findInboundByTag(r, "in-line-1-reality") == nil { t.Error("missing reality") }
    if findInboundByTag(r, "in-line-1-ws-tls")  == nil { t.Error("missing ws-tls") }
}

func findInboundByTag(r map[string]interface{}, tag string) map[string]interface{} {
    for _, ib := range r["inbounds"].([]interface{}) {
        m := ib.(map[string]interface{})
        if m["tag"] == tag { return m }
    }
    return nil
}
```

Update existing `TestGenerateConfig_StatsAndAPI` to construct `Inbounds` with one reality entry instead of `Routes`.

- [ ] **Step 2: Run**

Run: `cd agent && go test ./xray/...`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -am "test(agent/xray): cover reality + ws-tls + dual-transport inbounds"
```

---

### Task 10: 重写 `src/app/api/agent/config/route.ts` 的 Xray 段

**Files:**
- Modify: `src/app/api/agent/config/route.ts`

- [ ] **Step 1: Extract the per-line routing into a helper**

Open `src/app/api/agent/config/route.ts`. Find where `xrayRoutes.push({ lineId, uuids, port, tunnel, mark, branches })` is currently constructed (search "xrayRoutes.push"). Pull the `tunnel`, `mark`, and `branches` derivation out into a local helper:

```typescript
type LineRouting = { mark: number; tunnel: string; branches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[] };

function computeLineRouting(lineId: number): LineRouting {
  // Move the existing per-line branch / tunnel / mark calculation here verbatim,
  // returning the three fields. Do not change any of the values.
}
```

- [ ] **Step 2: Define the wire shape (local TS type)**

Wire shape mirrors `agent/api/config_types.go` `XrayInbound`. Add at the top of the handler file:

```typescript
type XrayInboundJson = {
  lineId: number;
  transport: "reality" | "ws-tls";
  protocol: "vless";
  port: number;
  realityPrivateKey?: string;
  realityShortId?: string;
  realityDest?: string;
  realityServerNames?: string[];
  wsPath?: string;
  tlsDomain?: string;
  tlsCert?: string;
  tlsKey?: string;
  uuids: string[];
  mark: number;
  tunnel: string;
  branches: LineRouting["branches"];
};
```

- [ ] **Step 3: Replace the existing `if (node.xrayConfig || node.xrayTransport === "ws-tls") { ... }` block**

```typescript
import { nodeProtocols, lineProtocols, lineNodes, devices } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { isXrayProtocol, transportToDeviceProtocol, type XrayTransport } from "@/lib/protocols";
import { and, eq } from "drizzle-orm";

const npRows = db.select().from(nodeProtocols)
  .where(eq(nodeProtocols.nodeId, nodeId))
  .all();

const transports: XrayTransport[] = npRows
  .filter(r => isXrayProtocol(r.protocol))
  .map(r => r.protocol === "xray-reality" ? "reality" as const : "ws-tls" as const);

const linesAsEntryRows = db.select({ id: lineNodes.lineId }).from(lineNodes)
  .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.role, "entry")))
  .all();

const xrayInbounds: XrayInboundJson[] = [];

for (const transport of transports) {
  const dp = transportToDeviceProtocol(transport);
  const npRow = npRows.find(r => r.protocol === dp)!;
  const cfg = JSON.parse(npRow.config);

  for (const { id: lineId } of linesAsEntryRows) {
    const lp = db.select().from(lineProtocols)
      .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, dp)))
      .get();
    if (!lp || lp.port == null) continue;

    const uuidRows = db.select({ uuid: devices.xrayUuid }).from(devices)
      .where(and(eq(devices.lineId, lineId), eq(devices.protocol, dp)))
      .all();
    const uuids = uuidRows.map(r => r.uuid).filter((u): u is string => !!u);
    if (uuids.length === 0) continue;

    const routing = computeLineRouting(lineId);
    const base: XrayInboundJson = {
      lineId, transport, protocol: "vless", port: lp.port,
      uuids,
      mark: routing.mark, tunnel: routing.tunnel, branches: routing.branches,
    };
    if (transport === "reality") {
      xrayInbounds.push({
        ...base,
        realityPrivateKey: decrypt(cfg.realityPrivateKey),
        realityShortId: cfg.realityShortId,
        realityDest: cfg.realityDest,
        realityServerNames: [cfg.realityServerName],
      });
    } else {
      xrayInbounds.push({
        ...base,
        wsPath: cfg.wsPath,
        tlsDomain: cfg.tlsDomain,
        tlsCert: cfg.tlsCert ?? "",
        tlsKey: cfg.tlsKey ? decrypt(cfg.tlsKey) : "",
      });
    }
  }
}

const xrayConfig = transports.length > 0 && xrayInbounds.length > 0
  ? { enabled: true, inbounds: xrayInbounds, dnsProxy: node.wgAddress?.split("/")[0] ?? "" }
  : { enabled: false, inbounds: [], dnsProxy: "" };
```

- [ ] **Step 2: Update SOCKS5 block (same file)**

Replace any read of `lines.socks5Port` with a query against `line_protocols` filtered by `protocol = "socks5"`. Use the same loop pattern: iterate lines where this node is entry; emit a SOCKS5 listener entry per line that has any `devices.protocol = "socks5"` device.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(api/agent/config): build XrayInbounds[] from node_protocols/line_protocols"
```

---

## Phase 3 — 节点 API

### Task 11: POST `/api/nodes` —— 接受 `protocols` payload

**Files:**
- Modify: `src/app/api/nodes/route.ts`

- [ ] **Step 1: Replace the validation block**

Locate the existing destructure that pulls `xrayTransport`, `xrayTlsDomain`, etc. Replace with:

```typescript
const {
  name, ip, domain, port, externalInterface, remark,
  protocols,
} = body as {
  name: string; ip: string; domain?: string; port?: number;
  externalInterface?: string; remark?: string;
  protocols?: {
    xrayReality?: { realityDest?: string };
    xrayWsTls?: { tlsDomain: string; certMode: "auto" | "manual"; tlsCert?: string; tlsKey?: string };
  };
};

if (!name || !ip) return error("VALIDATION_ERROR", "validation.nameAndIpRequired");

const reality = protocols?.xrayReality;
const wsTls = protocols?.xrayWsTls;
if (!reality && !wsTls) {
  return error("VALIDATION_ERROR", "validation.xrayTransportRequired");
}
if (wsTls && !wsTls.tlsDomain?.trim()) {
  return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
}
```

- [ ] **Step 2: Replace the persistence block**

After the node is inserted, call `enableNodeProtocol` for each enabled transport:

```typescript
import { enableNodeProtocol } from "@/lib/db/protocols";
import { generateRealityKeypair, generateShortId, normalizeRealityDest } from "@/lib/xray-helpers";  // existing
import { encrypt } from "@/lib/crypto";
import { randomBytes } from "node:crypto";

// after `const result = db.insert(nodes).values({ ... }).returning(...).get();`
if (reality) {
  const kp = generateRealityKeypair();
  const shortId = generateShortId();
  const { realityDest, realityServerName } = normalizeRealityDest(reality.realityDest);
  enableNodeProtocol(db, result.id, "xray-reality", {
    realityPrivateKey: encrypt(kp.privateKey),
    realityPublicKey: kp.publicKey,
    realityShortId: shortId,
    realityDest,
    realityServerName,
  });
}
if (wsTls) {
  enableNodeProtocol(db, result.id, "xray-wstls", {
    wsPath: "/" + randomBytes(4).toString("hex"),
    tlsDomain: wsTls.tlsDomain.trim(),
    certMode: wsTls.certMode,
    tlsCert: wsTls.certMode === "manual" ? wsTls.tlsCert ?? null : null,
    tlsKey:  wsTls.certMode === "manual" && wsTls.tlsKey ? encrypt(wsTls.tlsKey) : null,
  });
}
```

Remove all references to `xrayProtocol`, `xrayTransport`, `xrayConfig`, `xrayPort`, `xrayWsPath`, `xrayTls*` columns in the insert values — those columns no longer exist.

- [ ] **Step 3: Update the response shape**

Change the response body to omit removed fields, and include the populated `protocols` shape (read back via `getNodeProtocols`).

- [ ] **Step 4: Type-check + smoke test in browser**

```bash
npx tsc --noEmit
npm run dev
```

Open the existing node-create form (broken UI for now — just submit via curl):
```bash
curl -X POST http://localhost:3000/api/nodes -H "Content-Type: application/json" \
  -d '{"name":"test","ip":"1.2.3.4","protocols":{"xrayReality":{"realityDest":"www.microsoft.com:443"}}}' \
  -H "Cookie: <session>"
```
Expected: 200 with node + `node_protocols` row created (verify with `sqlite3 data/wiremesh.db "select * from node_protocols"`).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api/nodes): accept protocols payload, persist via node_protocols"
```

---

### Task 12: PUT `/api/nodes/{id}` —— 增删改 protocols

**Files:**
- Modify: `src/app/api/nodes/[id]/route.ts`

- [ ] **Step 1: Replace the existing xray-related logic in the PUT handler**

The PUT must support: enable/disable each Xray transport, change config, with cascade-blocking validation.

```typescript
import {
  getNodeProtocols, enableNodeProtocol, setNodeProtocolConfig, disableNodeProtocol,
  getEntryNodeIdForLine, releaseLineProtocol,
} from "@/lib/db/protocols";

// after loading existing node and validating ownership
const currentProtocols = getNodeProtocols(db, nodeId);
const hasReality = currentProtocols.some(p => p.protocol === "xray-reality");
const hasWsTls   = currentProtocols.some(p => p.protocol === "xray-wstls");

const reqReality: { realityDest?: string } | null | undefined = body.protocols?.xrayReality;
const reqWsTls:   { tlsDomain: string; certMode: "auto"|"manual"; tlsCert?: string; tlsKey?: string } | null | undefined =
  body.protocols?.xrayWsTls;

const willHaveReality = reqReality === null ? false : (reqReality !== undefined ? true : hasReality);
const willHaveWsTls   = reqWsTls   === null ? false : (reqWsTls   !== undefined ? true : hasWsTls);
if (!willHaveReality && !willHaveWsTls) {
  return error("VALIDATION_ERROR", "validation.xrayTransportRequired");
}

// helper to find blocking devices for a given device-protocol on lines this node leads
async function findBlockingDevices(deviceProtocol: "xray-reality" | "xray-wstls") {
  const rows = db.select({
    id: devices.id, name: devices.name, lineId: devices.lineId,
  }).from(devices)
    .innerJoin(lineNodes, eq(lineNodes.lineId, devices.lineId))
    .where(and(
      eq(devices.protocol, deviceProtocol),
      eq(lineNodes.nodeId, nodeId),
      eq(lineNodes.role, "entry"),
    ))
    .all();
  return rows;
}

// disable Reality
if (reqReality === null && hasReality) {
  const blockers = await findBlockingDevices("xray-reality");
  if (blockers.length > 0) {
    return error("CONFLICT", "validation.xrayTransportInUse", { transport: "reality", devices: blockers });
  }
  // also clean line_protocols rows on lines we lead
  const linesAsEntry = db.select({ id: lineNodes.lineId }).from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.role, "entry"))).all();
  for (const { id: lid } of linesAsEntry) releaseLineProtocol(db, lid, "xray-reality");
  disableNodeProtocol(db, nodeId, "xray-reality");
}

// disable WS+TLS (symmetric)
if (reqWsTls === null && hasWsTls) {
  const blockers = await findBlockingDevices("xray-wstls");
  if (blockers.length > 0) {
    return error("CONFLICT", "validation.xrayTransportInUse", { transport: "ws-tls", devices: blockers });
  }
  const linesAsEntry = db.select({ id: lineNodes.lineId }).from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.role, "entry"))).all();
  for (const { id: lid } of linesAsEntry) releaseLineProtocol(db, lid, "xray-wstls");
  disableNodeProtocol(db, nodeId, "xray-wstls");
}

// enable Reality (was off, now on)
if (reqReality !== undefined && reqReality !== null && !hasReality) {
  const kp = generateRealityKeypair();
  const shortId = generateShortId();
  const { realityDest, realityServerName } = normalizeRealityDest(reqReality.realityDest);
  enableNodeProtocol(db, nodeId, "xray-reality", {
    realityPrivateKey: encrypt(kp.privateKey),
    realityPublicKey: kp.publicKey,
    realityShortId: shortId,
    realityDest,
    realityServerName,
  });
}

// modify Reality (was on, still on, dest changed)
if (reqReality !== undefined && reqReality !== null && hasReality) {
  const cur = JSON.parse(currentProtocols.find(p => p.protocol === "xray-reality")!.config);
  if (reqReality.realityDest && reqReality.realityDest !== cur.realityDest) {
    const { realityDest, realityServerName } = normalizeRealityDest(reqReality.realityDest);
    setNodeProtocolConfig(db, nodeId, "xray-reality", {
      ...cur,
      realityDest,
      realityServerName,
    });
  }
}

// enable WS+TLS
if (reqWsTls !== undefined && reqWsTls !== null && !hasWsTls) {
  if (!reqWsTls.tlsDomain?.trim()) return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
  enableNodeProtocol(db, nodeId, "xray-wstls", {
    wsPath: "/" + randomBytes(4).toString("hex"),
    tlsDomain: reqWsTls.tlsDomain.trim(),
    certMode: reqWsTls.certMode,
    tlsCert: reqWsTls.certMode === "manual" ? reqWsTls.tlsCert ?? null : null,
    tlsKey:  reqWsTls.certMode === "manual" && reqWsTls.tlsKey ? encrypt(reqWsTls.tlsKey) : null,
  });
}

// modify WS+TLS
if (reqWsTls !== undefined && reqWsTls !== null && hasWsTls) {
  const cur = JSON.parse(currentProtocols.find(p => p.protocol === "xray-wstls")!.config);
  setNodeProtocolConfig(db, nodeId, "xray-wstls", {
    ...cur,
    tlsDomain: reqWsTls.tlsDomain.trim(),
    certMode:  reqWsTls.certMode,
    tlsCert:   reqWsTls.certMode === "manual" ? (reqWsTls.tlsCert ?? cur.tlsCert) : null,
    tlsKey:    reqWsTls.certMode === "manual"
                 ? (reqWsTls.tlsKey ? encrypt(reqWsTls.tlsKey) : cur.tlsKey)
                 : null,
  });
}
```

- [ ] **Step 2: Update non-protocol fields handling**

Keep the existing `name`/`ip`/`domain`/`port`/`externalInterface`/`remark`/`tunnelPortBlacklist` updates. Remove all references to `xrayProtocol`/`xrayTransport`/`xrayConfig`/`xrayPort`/`xrayWsPath`/`xrayTls*` (those columns are gone).

- [ ] **Step 3: SSE notify**

Keep the existing `sseManager.notifyNodeConfigUpdate(nodeId)` call. After protocol changes, also notify so agent re-pulls config.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api/nodes/[id]): support protocols add/modify/remove with cascade checks"
```

---

### Task 13: GET `/api/nodes/{id}` —— 返回 `protocols` 形态

**Files:**
- Modify: `src/app/api/nodes/[id]/route.ts`

- [ ] **Step 1: Update the GET handler**

Build the response with `protocols` derived from `node_protocols`. Strip secrets:

```typescript
import { getNodeProtocols } from "@/lib/db/protocols";

// inside GET, after loading the node:
const npRows = getNodeProtocols(db, nodeId);
const np = Object.fromEntries(npRows.map(r => [r.protocol, JSON.parse(r.config)]));

const protocols = {
  xrayReality: np["xray-reality"]
    ? {
        realityDest:        np["xray-reality"].realityDest,
        realityPublicKey:   np["xray-reality"].realityPublicKey,
        realityShortId:     np["xray-reality"].realityShortId,
        realityServerName:  np["xray-reality"].realityServerName,
      }
    : null,
  xrayWsTls: np["xray-wstls"]
    ? {
        tlsDomain: np["xray-wstls"].tlsDomain,
        certMode:  np["xray-wstls"].certMode,
        wsPath:    np["xray-wstls"].wsPath,
        hasCert:   !!np["xray-wstls"].tlsCert,
      }
    : null,
};

return success({ ...node, protocols });
```

- [ ] **Step 2: Smoke test**

```bash
curl http://localhost:3000/api/nodes/1 -H "Cookie: <session>" | jq .data.protocols
```
Expected: shows `xrayReality` with publicKey, no privateKey; `xrayWsTls` (or null).

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(api/nodes/[id]): return protocols in GET response without secrets"
```

---

## Phase 4 — 设备 API

### Task 14: 更新 `POST /api/devices` 协议校验与端口分配

**Files:**
- Modify: `src/app/api/devices/route.ts`

- [ ] **Step 1: Replace the protocol-validation line**

```typescript
import { DEVICE_PROTOCOLS, isXrayProtocol } from "@/lib/protocols";

if (!protocol || !DEVICE_PROTOCOLS.includes(protocol)) {
  return error("VALIDATION_ERROR", "validation.protocolInvalid");
}
```

- [ ] **Step 2: Replace the per-protocol creation branches**

The existing branches treat `protocol === "xray"`. Update to:

```typescript
if (protocol === "wireguard") {
  // existing wireguard logic untouched
} else if (isXrayProtocol(protocol)) {
  // existing xray uuid generation
  insertValues.xrayUuid = crypto.randomUUID();
} else if (protocol === "socks5") {
  // existing socks5 logic untouched
}
```

- [ ] **Step 3: Replace port-allocation block (with lazy node_protocols for WG/SOCKS5)**

The current code reads `lines.xrayPort` / `lines.socks5Port`. Replace with:

```typescript
import {
  ensureLineProtocol, isProtocolSupportedByEntryNode, enableNodeProtocol,
  getEntryNodeIdForLine, getDefaultProxyBasePort,
} from "@/lib/db/protocols";

if (lineId) {
  const entryNodeId = getEntryNodeIdForLine(db, lineId);
  if (!entryNodeId) {
    return error("VALIDATION_ERROR", "validation.lineHasNoEntryNode");
  }

  if (isXrayProtocol(protocol)) {
    // Xray transports must be explicitly enabled on the node
    if (!isProtocolSupportedByEntryNode(db, entryNodeId, protocol)) {
      return error("CONFLICT", "validation.deviceProtocolNotSupported");
    }
  } else {
    // WireGuard / SOCKS5: lazy-create node_protocols row on first device
    if (!isProtocolSupportedByEntryNode(db, entryNodeId, protocol)) {
      enableNodeProtocol(db, entryNodeId, protocol, {});
    }
  }

  // lazy-allocate per-line port (WireGuard returns null and only marks the row)
  const startPort = getDefaultProxyBasePort(db);
  ensureLineProtocol(db, lineId, protocol, { startPort });
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api/devices): expand protocol enum, validate vs entry node, lazy port alloc"
```

---

### Task 15: 更新 DELETE `/api/devices/{id}` 端口回收

**Files:**
- Modify: `src/app/api/devices/[id]/route.ts`

- [ ] **Step 1: Replace the port cleanup block**

```typescript
import { releaseLineProtocol } from "@/lib/db/protocols";
import { isXrayProtocol } from "@/lib/protocols";

// after deleting the device row
if (existing.lineId && (isXrayProtocol(existing.protocol) || existing.protocol === "socks5")) {
  // any other devices on the line still using this protocol?
  const remaining = db.select({ id: devices.id }).from(devices)
    .where(and(eq(devices.lineId, existing.lineId), eq(devices.protocol, existing.protocol)))
    .get();
  if (!remaining) {
    releaseLineProtocol(db, existing.lineId, existing.protocol);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(api/devices/[id]): release line_protocols on last device removal"
```

---

### Task 16: 更新 PUT `/api/devices/{id}/line` —— 改线路时校验与重分配

**Files:**
- Modify: `src/app/api/devices/[id]/line/route.ts`

- [ ] **Step 1: Replace logic**

Keys: when device's line changes, validate the new line's entry node supports `device.protocol` (lazy-create for WG/SOCKS5), then `ensureLineProtocol` on the new line, and `releaseLineProtocol` on the old line if no peers remain.

```typescript
import {
  ensureLineProtocol, releaseLineProtocol, enableNodeProtocol,
  isProtocolSupportedByEntryNode, getEntryNodeIdForLine, getDefaultProxyBasePort,
} from "@/lib/db/protocols";
import { isXrayProtocol } from "@/lib/protocols";

const oldLineId = device.lineId;
const newLineId = body.lineId;

if (newLineId) {
  const entryNodeId = getEntryNodeIdForLine(db, newLineId);
  if (!entryNodeId) return error("VALIDATION_ERROR", "validation.lineHasNoEntryNode");
  if (isXrayProtocol(device.protocol)) {
    if (!isProtocolSupportedByEntryNode(db, entryNodeId, device.protocol)) {
      return error("CONFLICT", "validation.deviceProtocolNotSupported");
    }
  } else {
    if (!isProtocolSupportedByEntryNode(db, entryNodeId, device.protocol)) {
      enableNodeProtocol(db, entryNodeId, device.protocol, {});
    }
  }
  ensureLineProtocol(db, newLineId, device.protocol, { startPort: getDefaultProxyBasePort(db) });
}

// update device.lineId to newLineId

if (oldLineId && oldLineId !== newLineId) {
  const peers = db.select({ id: devices.id }).from(devices)
    .where(and(eq(devices.lineId, oldLineId), eq(devices.protocol, device.protocol)))
    .get();
  if (!peers) releaseLineProtocol(db, oldLineId, device.protocol);
}
```

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(api/devices/[id]/line): validate compatibility and re-allocate ports on rebind"
```

---

### Task 17: 更新 GET `/api/devices/{id}/config`

**Files:**
- Modify: `src/app/api/devices/[id]/config/route.ts`

- [ ] **Step 1: Replace the protocol branching**

Old code branches on `protocol === "xray"` then on node's `xrayTransport`. Replace with:

```typescript
import { isXrayProtocol, deviceProtocolToTransport } from "@/lib/protocols";
import { getNodeProtocol, getLineProtocolPort } from "@/lib/db/protocols";

if (protocol === "wireguard") {
  // existing wireguard config generation untouched
}

if (isXrayProtocol(protocol)) {
  const transport = deviceProtocolToTransport(protocol)!;  // "reality" | "ws-tls"
  const npRow = getNodeProtocol(db, entryNodeId, protocol);
  if (!npRow) return error("CONFLICT", "validation.deviceProtocolNotSupported");
  const cfg = JSON.parse(npRow.config);

  const port = getLineProtocolPort(db, lineId, protocol);
  if (port == null) return error("INTERNAL_ERROR", "internal.missingProtocolPort");

  if (transport === "reality") {
    // build vless+reality config using cfg.realityPublicKey, cfg.realityShortId, cfg.realityServerName
    // and the device's xrayUuid + the line's port
  } else {
    // build vless+ws+tls config using cfg.wsPath, cfg.tlsDomain
  }
}

if (protocol === "socks5") {
  const port = getLineProtocolPort(db, lineId, "socks5");
  // ... existing socks5 with the per-line port
}
```

Replace any reference to `node.xrayTransport`, `node.xrayWsPath`, `node.xrayTlsDomain`, `node.xrayConfig` with the corresponding fields read from `npRow.config` (parsed). Replace `line.xrayPort` / `line.socks5Port` with `getLineProtocolPort()` calls.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(api/devices/[id]/config): drive xray config from node_protocols + line_protocols"
```

---

## Phase 5 — 订阅/Builder 重构

### Task 18: 更新 `subscription/types.ts`

**Files:**
- Modify: `src/lib/subscription/types.ts`

- [ ] **Step 1: Replace the EntryNodeContext shape**

Drop `xrayTransport`, `xrayTlsDomain`, `xrayWsPath` and instead carry per-transport sub-objects (only the one matching the device's protocol is populated):

```typescript
export interface EntryNodeContext {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  wgPort: number;
  wgPublicKey: string;
  wgAddress: string;
  // active transport for this device:
  xrayReality?: { publicKey: string; shortId: string; dest: string; serverName: string } | null;
  xrayWsTls?:   { wsPath: string; tlsDomain: string } | null;
}

export type DeviceProtocol = "wireguard" | "xray-reality" | "xray-wstls" | "socks5";

export interface DeviceContext {
  id: number;
  name: string;
  remark: string | null;
  protocol: DeviceProtocol;
  lineId: number | null;
  linePort: number | null;       // port for THIS device's protocol (replaces lineXrayPort/lineSocks5Port)
  entry: EntryNodeContext;
  wg?:    { privateKey: string; publicKey: string; address: string; addressIp: string };
  xray?:  { uuid: string };
  socks5?: { username: string; password: string };
}
```

- [ ] **Step 2: Commit**

```bash
git commit -am "refactor(subscription/types): per-transport entry context + linePort"
```

---

### Task 19: 重写 `load-device-context.ts`

**Files:**
- Modify: `src/lib/subscription/load-device-context.ts`

- [ ] **Step 1: Replace the entry-node loading block**

```typescript
import { getNodeProtocol, getLineProtocolPort } from "@/lib/db/protocols";
import { isXrayProtocol } from "@/lib/protocols";

const entryRow = /* existing query for entry node by line */;
const linePort = device.lineId
  ? getLineProtocolPort(db, device.lineId, device.protocol)
  : null;

const entry: EntryNodeContext = {
  id: entryRow.id, name: entryRow.name, ip: entryRow.ip, domain: entryRow.domain,
  wgPort: entryRow.port, wgPublicKey: entryRow.wgPublicKey, wgAddress: entryRow.wgAddress.split("/")[0],
};

if (device.protocol === "xray-reality") {
  const np = getNodeProtocol(db, entryRow.id, "xray-reality");
  if (!np) return null;
  const cfg = JSON.parse(np.config);
  entry.xrayReality = {
    publicKey: cfg.realityPublicKey,
    shortId:   cfg.realityShortId,
    dest:      cfg.realityDest,
    serverName: cfg.realityServerName,
  };
}
if (device.protocol === "xray-wstls") {
  const np = getNodeProtocol(db, entryRow.id, "xray-wstls");
  if (!np) return null;
  const cfg = JSON.parse(np.config);
  entry.xrayWsTls = { wsPath: cfg.wsPath, tlsDomain: cfg.tlsDomain };
}

const ctx: DeviceContext = {
  id: device.id, name: device.name, remark: device.remark,
  protocol: device.protocol as DeviceProtocol,
  lineId: device.lineId, linePort,
  entry,
};
// then per-protocol fill ctx.wg / ctx.xray / ctx.socks5 (existing logic adapted)
```

Drop the `xrayTransport`/`xrayTlsDomain`/`xrayWsPath` reads from the nodes table (those columns no longer exist).

- [ ] **Step 2: Update existing tests in __tests__/lib/subscription that construct EntryNodeContext fixtures**

Replace fixture usages of `xrayTransport: "reality"` etc with `xrayReality: { publicKey, shortId, dest, serverName }` (or `xrayWsTls`). Update `protocol: "xray"` to `protocol: "xray-reality"` and adjust assertions.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(subscription/load-device-context): pull from node_protocols/line_protocols"
```

---

### Task 20: 重写 5 个 builder

**Files:**
- Modify: `src/lib/subscription/clash-builder.ts`
- Modify: `src/lib/subscription/singbox-builder.ts`
- Modify: `src/lib/subscription/uri-builders.ts`
- Modify: `src/lib/subscription/v2ray-builder.ts`
- Modify: `src/lib/subscription/shadowrocket-builder.ts`

- [ ] **Step 1: For each builder, replace the protocol branches**

Find every `if (ctx.protocol === "xray")` and split into two:

```typescript
if (ctx.protocol === "xray-reality") {
  // use ctx.entry.xrayReality.{publicKey, shortId, dest, serverName}
  // use ctx.linePort as the port
}
if (ctx.protocol === "xray-wstls") {
  // use ctx.entry.xrayWsTls.{wsPath, tlsDomain}
  // use ctx.linePort as the port
}
```

For each builder:
- **clash-builder.ts**: existing branches on `ctx.entry.xrayTransport` — replace with branch on `ctx.protocol`.
- **singbox-builder.ts**: same.
- **uri-builders.ts** (`buildVlessUri`): split into two paths or keep one function but branch on `ctx.protocol`.
- **v2ray-builder.ts**: routes to `buildVlessUri` based on `ctx.protocol`; update guard from `ctx.protocol === "xray"` to `isXrayProtocol(ctx.protocol)`.
- **shadowrocket-builder.ts**: same pattern.

Replace any `ctx.lineXrayPort` / `ctx.lineSocks5Port` with `ctx.linePort`.

- [ ] **Step 2: Update each builder's tests** (`__tests__/lib/subscription/*.test.ts`)

For each test fixture:
- Replace `protocol: "xray"` with `protocol: "xray-reality"` (or `-wstls` as appropriate)
- Replace `xrayTransport: "reality"` on the entry with `xrayReality: { publicKey: "REALPUB", shortId: "abcd", dest: "www.x.com:443", serverName: "www.x.com" }`
- Replace `lineXrayPort: 41443` / `lineSocks5Port: 41444` with `linePort: 41443`
- Add at least one test per builder for the `xray-wstls` path

Pattern (clash-builder example):
```typescript
function xrayWsTlsCtx(): DeviceContext {
  return {
    id: 12, name: "tablet", remark: null,
    protocol: "xray-wstls", lineId: 1, linePort: 41444,
    entry: { ...baseEntry, xrayReality: null, xrayWsTls: { wsPath: "/abc", tlsDomain: "node.example.com" } },
    xray: { uuid: "11111111-1111-1111-1111-111111111111" },
  };
}

it("buildClashProxy emits ws+tls fields for xray-wstls", () => {
  const proxy = buildClashProxy(xrayWsTlsCtx());
  expect(proxy.network).toBe("ws");
  expect(proxy.tls).toBe(true);
  expect(proxy["ws-opts"].path).toBe("/abc");
  expect(proxy.servername).toBe("node.example.com");
});
```

- [ ] **Step 3: Run all subscription tests**

Run: `npm test -- __tests__/lib/subscription/`
Expected: PASS (all builder tests).

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(subscription/builders): branch on device.protocol; cover xray-wstls explicitly"
```

---

### Task 21: 更新 `formats.ts` 的 FORMAT_PROTOCOL_SUPPORT

**Files:**
- Modify: `src/lib/subscription/formats.ts`
- Modify: `__tests__/lib/subscription/formats.test.ts`

- [ ] **Step 1: Update the matrix**

```typescript
export const FORMAT_PROTOCOL_SUPPORT: Record<FormatKind, Record<DeviceProtocol, boolean>> = {
  clash:        { wireguard: true, "xray-reality": true, "xray-wstls": true, socks5: true },
  shadowrocket: { wireguard: true, "xray-reality": true, "xray-wstls": true, socks5: true },
  v2ray:        { wireguard: true, "xray-reality": true, "xray-wstls": true, socks5: true },
  singbox:      { wireguard: true, "xray-reality": true, "xray-wstls": true, socks5: true },
};
```

Update any callers iterating `(p: "wireguard" | "xray" | "socks5")` to the new four-key shape.

- [ ] **Step 2: Update format tests to use new keys**

- [ ] **Step 3: Run tests**

Run: `npm test -- __tests__/lib/subscription/formats.test.ts`
Expected: PASS.

- [ ] **Step 4: Update `subscriptionGroups/[id]/page.tsx` wgSkippedWarning logic if it relies on protocol values** — change `d.protocol === "wireguard"` checks if any. Search:
```bash
grep -rn "\"xray\"" src/
```
Replace each match with the new enum value or `isXrayProtocol(...)` as appropriate.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(subscription/formats): expand support matrix to four protocols"
```

---

## Phase 6 — UI: Nodes 页面 Tabs

### Task 22: 节点新增页 —— shadcn Tabs 改造

**Files:**
- Modify: `src/app/(dashboard)/nodes/new/page.tsx`

- [ ] **Step 1: Add new state**

Replace the single `xrayTransport` state with:

```typescript
const [realityEnabled, setRealityEnabled] = useState(true);
const [wsTlsEnabled, setWsTlsEnabled] = useState(false);
const [activeTab, setActiveTab] = useState<"xray-reality" | "xray-wstls">("xray-reality");
const [realityDest, setRealityDest] = useState(DEFAULT_REALITY_DEST);
// (keep existing tlsDomain/tlsCertMode/tlsCert/tlsKey states)
```

- [ ] **Step 2: Replace the transport `<Select>` block with Tabs**

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { X } from "lucide-react";

const enabledCount = (realityEnabled ? 1 : 0) + (wsTlsEnabled ? 1 : 0);
const canRemove = (which: "xray-reality" | "xray-wstls") =>
  enabledCount > 1 && (which === "xray-reality" ? realityEnabled : wsTlsEnabled);

<div className="space-y-2">
  <Label>{ts("xrayProtocols.title")}</Label>
  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
    <div className="flex items-center justify-between">
      <TabsList>
        {realityEnabled && (
          <TabsTrigger value="xray-reality" className="group relative">
            {ts("xrayProtocols.realityTabLabel")}
            {canRemove("xray-reality") && (
              <button type="button" className="ml-2 opacity-60 hover:opacity-100"
                aria-label={ts("xrayProtocols.removeTooltip")}
                onClick={(e) => { e.stopPropagation(); setRealityEnabled(false);
                  if (activeTab === "xray-reality") setActiveTab("xray-wstls"); }}>
                <X className="h-3 w-3" />
              </button>
            )}
          </TabsTrigger>
        )}
        {wsTlsEnabled && (
          <TabsTrigger value="xray-wstls" className="group relative">
            {ts("xrayProtocols.wsTlsTabLabel")}
            {canRemove("xray-wstls") && (
              <button type="button" className="ml-2 opacity-60 hover:opacity-100"
                aria-label={ts("xrayProtocols.removeTooltip")}
                onClick={(e) => { e.stopPropagation(); setWsTlsEnabled(false);
                  if (activeTab === "xray-wstls") setActiveTab("xray-reality"); }}>
                <X className="h-3 w-3" />
              </button>
            )}
          </TabsTrigger>
        )}
      </TabsList>
      <div className="flex gap-2">
        {!realityEnabled && (
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setRealityEnabled(true); setActiveTab("xray-reality"); }}>
            + {ts("xrayProtocols.addReality")}
          </Button>
        )}
        {!wsTlsEnabled && (
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setWsTlsEnabled(true); setActiveTab("xray-wstls"); }}>
            + {ts("xrayProtocols.addWsTls")}
          </Button>
        )}
      </div>
    </div>

    <TabsContent value="xray-reality" className="space-y-2 pt-4">
      <Label htmlFor="realityDest">{t("realityTarget")}</Label>
      <Input id="realityDest" value={realityDest}
        onChange={(e) => setRealityDest(e.target.value)}
        placeholder="www.microsoft.com:443" />
      <p className="text-xs text-muted-foreground">{t("realityTargetHint")}</p>
    </TabsContent>

    <TabsContent value="xray-wstls" className="space-y-4 pt-4">
      {/* existing tlsDomain / tlsCertMode / tlsCert / tlsKey fields verbatim */}
    </TabsContent>
  </Tabs>
</div>
```

- [ ] **Step 3: Remove the "代理起始端口" form field** (was `xrayPort` input)

- [ ] **Step 4: Replace the submit-payload assembly**

```typescript
const body: Record<string, unknown> = {
  name: name.trim(), ip: ip.trim(),
  domain: domain.trim() || null,
  port: port ? parseInt(port) : undefined,
  remark: remark.trim() || null,
  externalInterface: externalInterface.trim() || "eth0",
  protocols: {
    xrayReality: realityEnabled ? { realityDest: realityDest || undefined } : undefined,
    xrayWsTls:   wsTlsEnabled
      ? { tlsDomain: tlsDomain.trim(), certMode: tlsCertMode,
          tlsCert: tlsCertMode === "manual" ? tlsCert : undefined,
          tlsKey:  tlsCertMode === "manual" ? tlsKey  : undefined }
      : undefined,
  },
};
```

- [ ] **Step 5: Verify in browser**

Run: `npm run dev`. Open `/nodes/new`:
- Default: Reality tab visible, WS+TLS hidden behind "+ 添加 WebSocket+TLS"
- Click that button → WS+TLS tab appears, can switch
- ✕ on Reality is hidden (only one transport); after enabling WS+TLS, both ✕ become available
- Submitting creates the node + protocols rows

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(nodes/new): tabs UI with add/remove for Reality and WS+TLS"
```

---

### Task 23: 节点编辑页 —— 同样改造 + 移除时调用 API + 处理依赖错误

**Files:**
- Modify: `src/app/(dashboard)/nodes/[id]/page.tsx`

- [ ] **Step 1: Update state init from API GET response**

```typescript
useEffect(() => {
  fetch(`/api/nodes/${id}`).then(r => r.json()).then(({ data }) => {
    setRealityEnabled(!!data.protocols.xrayReality);
    setWsTlsEnabled(!!data.protocols.xrayWsTls);
    setActiveTab(data.protocols.xrayReality ? "xray-reality" : "xray-wstls");
    if (data.protocols.xrayReality) {
      setRealityDest(data.protocols.xrayReality.realityDest);
      setRealityPublicKey(data.protocols.xrayReality.realityPublicKey);
      setRealityShortId(data.protocols.xrayReality.realityShortId);
    }
    if (data.protocols.xrayWsTls) {
      setTlsDomain(data.protocols.xrayWsTls.tlsDomain);
      setTlsCertMode(data.protocols.xrayWsTls.certMode);
      setWsPath(data.protocols.xrayWsTls.wsPath);
    }
    // ... other fields
  });
}, [id]);
```

- [ ] **Step 2: Implement the immediate-remove flow**

When user clicks ✕ on a tab, send a single `PUT /api/nodes/{id}` with the relevant `protocols.<x> = null`. On 409 with `validation.xrayTransportInUse`, show a modal listing blocking devices.

```typescript
async function removeTransport(which: "xray-reality" | "xray-wstls") {
  const body = {
    protocols: {
      xrayReality: which === "xray-reality" ? null : undefined,
      xrayWsTls:   which === "xray-wstls"   ? null : undefined,
    },
  };
  const res = await fetch(`/api/nodes/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.ok) {
    if (which === "xray-reality") setRealityEnabled(false);
    if (which === "xray-wstls")   setWsTlsEnabled(false);
    if (activeTab === which) setActiveTab(which === "xray-reality" ? "xray-wstls" : "xray-reality");
    return;
  }
  const err = await res.json();
  if (err.code === "CONFLICT" && err.error === "validation.xrayTransportInUse") {
    showBlockingDevicesDialog(err.details.devices);
  } else {
    toast.error(t(err.error));
  }
}
```

- [ ] **Step 3: Replace the existing tabs UX with the same Tabs structure as Task 22**, swapping `realityEnabled`'s ✕ handler to call `removeTransport("xray-reality")` (and same for WS+TLS). The "+ 添加" buttons send a `PUT` adding the transport with sensible defaults (Reality: prompt for dest in tab; WS+TLS: prompt for tlsDomain).

- [ ] **Step 4: Add a `BlockingDevicesDialog` component**

```tsx
function BlockingDevicesDialog({ open, devices, onClose }: { open: boolean; devices: { id: number; name: string; lineId: number }[]; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogTitle>{t("xrayTransportInUseTitle")}</DialogTitle>
        <ul className="space-y-1 text-sm">
          {devices.map(d => (
            <li key={d.id}>
              <Link href={`/devices/${d.id}`}>{d.name}</Link>
              <span className="text-muted-foreground"> ({t("inLine", { id: d.lineId })})</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Verify in browser**

- Bind a test device with `xray-reality` to a line whose entry is the node being edited
- Try to remove the Reality tab → expect dialog listing the device
- Remove the device, retry → success

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(nodes/[id]): tabs editor with remove cascade UX"
```

---

## Phase 7 — UI: 设备页

### Task 24: 设备新增页 —— 协议下拉扩 4 项

**Files:**
- Modify: `src/app/(dashboard)/devices/new/page.tsx`

- [ ] **Step 1: Update state and dropdown**

```typescript
const [protocol, setProtocol] = useState<DeviceProtocol>("wireguard");
```

```tsx
<Select value={protocol} onValueChange={(v) => setProtocol(v as DeviceProtocol)}>
  <SelectContent>
    <SelectItem value="wireguard">WireGuard</SelectItem>
    <SelectItem value="xray-reality">{t("protocol.xrayReality")}</SelectItem>
    <SelectItem value="xray-wstls">{t("protocol.xrayWsTls")}</SelectItem>
    <SelectItem value="socks5">SOCKS5</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 2: (Optional) Show inline incompatibility hint**

When `lineId` and `protocol` are both selected, fetch `/api/lines/{lineId}` (or include in the lines list) the entry node's enabled protocols, and show a warning if the protocol isn't supported. Server-side validation is the source of truth; this is a UX nicety.

- [ ] **Step 3: Verify in browser**

Submit each of the 4 protocols, with a line that supports / doesn't support each. Expect server-side rejection for incompatible combos.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(devices/new): expand protocol dropdown to four options"
```

---

### Task 25: 设备编辑页 —— 协议字段只读展示

**Files:**
- Modify: `src/app/(dashboard)/devices/[id]/page.tsx`

- [ ] **Step 1: Add labels for the new types**

```tsx
<dt>{t("protocol")}</dt>
<dd>{t(`protocol.${device.protocol === "xray-reality" ? "xrayReality" : device.protocol === "xray-wstls" ? "xrayWsTls" : device.protocol}`)}</dd>
```

For UUID display, change the condition from `device.protocol === "xray"` to `isXrayProtocol(device.protocol)`.

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(devices/[id]): show new protocol labels and reuse uuid view for both xray types"
```

---

### Task 26: 设备列表 —— 徽章与地址列

**Files:**
- Modify: `src/app/(dashboard)/devices/page.tsx`

- [ ] **Step 1: Update PROTOCOL_VARIANTS**

```typescript
const PROTOCOL_VARIANTS: Record<DeviceProtocol, "default" | "secondary" | "destructive" | "outline"> = {
  wireguard: "default",
  "xray-reality": "outline",
  "xray-wstls":   "secondary",
  socks5:         "destructive",
};
```

(Adjust visual tones to taste — the spec only requires distinguishability.)

- [ ] **Step 2: Replace badge text logic**

```tsx
{t(`protocol.${row.protocol === "xray-reality" ? "xrayReality" : row.protocol === "xray-wstls" ? "xrayWsTls" : row.protocol}`)}
```

- [ ] **Step 3: Replace address column branch**

```tsx
{row.protocol === "wireguard"
  ? (row.wgAddress ?? "—")
  : (isXrayProtocol(row.protocol) || row.protocol === "socks5")
    ? (row.xrayUuid ?? row.socks5Username ?? "—")
    : "—"}
```

- [ ] **Step 4: Verify in browser**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(devices/list): four-protocol badges and address rendering"
```

---

### Task 27: `node-ports-detail` 双传输并列

**Files:**
- Modify: `src/components/node-ports-detail.tsx`

- [ ] **Step 1: Update component signature**

The component currently accepts `xrayTransport` and a single port list. Change it to accept an array of port groups:

```typescript
interface PortGroup { protocol: DeviceProtocol; label: string; ports: { lineId: number; port: number }[]; }
interface Props { node: { id: number; name: string }; groups: PortGroup[]; }
```

- [ ] **Step 2: Render each group as its own row**

```tsx
{groups.map(g => (
  <div key={g.protocol} className="flex items-baseline gap-2">
    <Badge variant="outline">{g.label}</Badge>
    <span className="font-mono text-xs">
      {g.ports.map(p => `L${p.lineId}:${p.port}`).join(" • ")}
    </span>
  </div>
))}
```

- [ ] **Step 3: Have the nodes-list API include port groups in its response**

Find the existing `GET /api/nodes` handler (`src/app/api/nodes/route.ts`). For each node row, add a `portGroups` field built by:

```typescript
import { lineNodes, lineProtocols, lines as linesTable } from "@/lib/db/schema";

function loadPortGroupsForNode(nodeId: number) {
  const rows = db
    .select({
      protocol: lineProtocols.protocol,
      lineId:   lineProtocols.lineId,
      port:     lineProtocols.port,
    })
    .from(lineProtocols)
    .innerJoin(lineNodes,
      and(eq(lineNodes.lineId, lineProtocols.lineId), eq(lineNodes.role, "entry")),
    )
    .where(eq(lineNodes.nodeId, nodeId))
    .all();

  const byProtocol = new Map<string, { lineId: number; port: number }[]>();
  for (const r of rows) {
    if (r.port == null) continue; // wireguard rows have null ports
    const list = byProtocol.get(r.protocol) ?? [];
    list.push({ lineId: r.lineId, port: r.port });
    byProtocol.set(r.protocol, list);
  }

  return Array.from(byProtocol.entries()).map(([protocol, ports]) => ({
    protocol, ports,
  }));
}
```

Call `loadPortGroupsForNode(node.id)` per row in the list response and attach as `node.portGroups`. The `nodes/page.tsx` then passes that to `<NodePortsDetail groups={node.portGroups.map(g => ({ ...g, label: t(\`protocol.${labelKey(g.protocol)}\`) }))} />`.

- [ ] **Step 4: Verify visually**

Open `/nodes` after creating a node with both transports + at least one device per transport. Expect two rows of port info.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(node-ports-detail): show all enabled protocols and their per-line ports"
```

---

## Phase 8 — i18n & 收尾

### Task 28: i18n keys

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add/replace the following keys (zh-CN)**

```json
{
  "nodes": {
    "xrayProtocols": {
      "title": "传输方式",
      "addReality": "添加 Reality",
      "addWsTls": "添加 WebSocket+TLS",
      "removeTooltip": "移除该传输",
      "lastTransportTooltip": "至少需保留一种传输方式",
      "realityTabLabel": "Reality",
      "wsTlsTabLabel": "WebSocket+TLS"
    }
  },
  "devices": {
    "protocol": {
      "wireguard": "WireGuard",
      "xrayReality": "Xray (Reality)",
      "xrayWsTls": "Xray (WS+TLS)",
      "socks5": "SOCKS5"
    }
  },
  "errors": {
    "validation": {
      "protocolInvalid": "协议必须为 wireguard / xray-reality / xray-wstls / socks5",
      "xrayTransportInUse": "节点存在依赖该传输的设备，无法移除",
      "xrayTransportRequired": "节点至少需保留一种 Xray 传输方式",
      "deviceProtocolNotSupported": "所选线路的入口节点未启用该协议",
      "wsTlsDomainRequired": "WebSocket+TLS 需要填写 TLS 域名",
      "lineHasNoEntryNode": "该线路缺少入口节点"
    }
  }
}
```

Mirror in `en.json` with English translations.

- [ ] **Step 2: Remove obsolete keys**

```bash
grep -rn '"xrayTransport"' messages/ src/
```
Delete any lingering `xrayTransport`, `xrayTransportReality`, `xrayTransportWsTls` keys (and unused references in code).

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(i18n): add xray multi-transport keys, drop obsolete singular ones"
```

---

### Task 29: 收尾 —— 移除遗留代码 + 全量类型检查 + 测试

**Files:**
- Various

- [ ] **Step 1: Search for stale references**

Run each of these and fix any matches:
```bash
grep -rn "xrayTransport" src/ agent/
grep -rn "node\.xrayConfig" src/
grep -rn "node\.xrayWsPath" src/
grep -rn "node\.xrayTls" src/
grep -rn "lines\.xrayPort" src/
grep -rn "lines\.socks5Port" src/
grep -rn "protocol === \"xray\"" src/
grep -rn "lineXrayPort\|lineSocks5Port" src/
```

Replace each with the new equivalents. For "lineXrayPort/lineSocks5Port" in the subscription types, those should be unified to `linePort` (Task 18).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all PASS.

Run: `cd agent && go test ./...`
Expected: all PASS.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean (or only pre-existing warnings unrelated to this work).

- [ ] **Step 5: Commit any residual fixups**

```bash
git commit -am "chore: clean up references to legacy xray fields"
```

---

### Task 30: E2E 验证（手动 + 可选 e2e-test skill）

**Files:** none

- [ ] **Step 1: Manual smoke**

```bash
rm -f data/wiremesh.db
npm run dev
```

Walk through:
1. Setup wizard
2. Create node with Reality only → verify Xray service generates one inbound on agent
3. Edit node, add WS+TLS → upload cert + domain → verify two inbounds in agent's xray config
4. Create line with that node as entry
5. Create 4 devices: WG, xray-reality, xray-wstls, socks5 → bind to that line
6. Inspect agent's `/etc/wiremesh/xray/config.json` (via SSH or agent log) — should see two xray inbounds with the right UUIDs
7. Generate subscription for each device, confirm:
   - Reality device: vless URI uses Reality params + the per-line port
   - WS+TLS device: vless URI uses ws path + tls domain + the per-line port
   - SOCKS5: socks5 URI on its own per-line port
   - WG: wg URI unchanged
8. Try to remove WS+TLS from node → expect blocking dialog listing the WS+TLS device
9. Delete the WS+TLS device → retry remove → succeeds; agent reduces to one inbound

- [ ] **Step 2: (Optional) Run the project's `e2e-test` skill**

If end-to-end deployment of test agents is desired, invoke the `e2e-test` skill per the project's testing conventions.

- [ ] **Step 3: Final commit / branch ready**

If on a feature branch:
```bash
git push -u origin <branch>
```
Then open a PR per the project's normal flow.

---

## Self-Review Checklist (already applied)

- All schema-removed fields replaced with new-table reads at every consumer
- Both xray transports tested in agent, builders, and UI flows
- Cascade error path covers both directions (remove Reality / remove WS+TLS)
- Lazy port allocation race conditions addressed via `ensureLineProtocol` (idempotent)
- No placeholder TODOs; every task contains concrete code or commands
