# 代理设置重构 + 节点端口列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 xrayEnabled 开关（代理服务由线路编排决定），始终生成 Reality 密钥，并在节点列表新增端口列。

**Architecture:** 分三阶段：1) 移除 xrayEnabled 相关逻辑（schema、API、表单）；2) 新增端口计算与 API 返回；3) 前端端口列 UI（Popover 展示分组详情）。

**Tech Stack:** Next.js App Router, Drizzle ORM (SQLite), React 18, shadcn/ui (Radix), next-intl

---

### Task 1: 移除 xrayEnabled — Schema 与迁移文件

**Files:**
- Modify: `src/lib/db/schema.ts:41`
- Modify: `drizzle/0000_striped_the_call.sql:110`

- [ ] **Step 1: 从 schema.ts 移除 xrayEnabled 字段**

在 `src/lib/db/schema.ts` 中，删除第 41 行：

```typescript
// 删除这一行：
xrayEnabled: integer("xray_enabled", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 2: 从迁移文件移除 xray_enabled 列**

在 `drizzle/0000_striped_the_call.sql` 中，删除第 110 行：

```sql
-- 删除这一行：
`xray_enabled` integer DEFAULT false NOT NULL,
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: 会出现多处引用 `xrayEnabled` 的编译错误，这是预期的，后续 Task 会逐一修复。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0000_striped_the_call.sql
git commit -m "refactor: remove xrayEnabled field from schema and migration"
```

---

### Task 2: 移除 xrayEnabled — 节点创建 API

**Files:**
- Modify: `src/app/api/nodes/route.ts`

- [ ] **Step 1: 修改 POST handler，始终生成 Reality 密钥**

在 `src/app/api/nodes/route.ts` 中，将解构 body 时移除 `xrayEnabled`（第 73 行），然后将第 125-153 行的条件生成逻辑改为始终执行：

```typescript
// 第 73 行：从解构中移除 xrayEnabled
const {
  name,
  ip,
  domain,
  port,
  xrayProtocol,
  xrayTransport,
  xrayPort,
  xrayConfig,
  externalInterface,
  remark,
} = body;
```

```typescript
// 第 125-137 行：移除 if (xrayEnabled) 条件，始终生成 Reality 密钥
const realityKeys = generateRealityKeypair();
const shortId = generateShortId();
const { realityDest, realityServerName } = normalizeRealityDest(body.realityDest);
const resolvedXrayConfig = JSON.stringify({
  realityPrivateKey: encrypt(realityKeys.privateKey),
  realityPublicKey: realityKeys.publicKey,
  realityShortId: shortId,
  realityDest,
  realityServerName,
});
```

```typescript
// 第 139-157 行 insert values：移除 xrayEnabled，始终设置 xray 字段
const result = db
  .insert(nodes)
  .values({
    name,
    ip,
    domain: domain ?? null,
    port: resolvedPort,
    agentToken,
    wgPrivateKey: encryptedPrivateKey,
    wgPublicKey: publicKey,
    wgAddress,
    xrayProtocol: "vless",
    xrayTransport: "tcp",
    xrayPort: xrayPort ?? parseInt(settingsMap["xray_default_port"] ?? String(DEFAULT_PROXY_PORT)),
    xrayConfig: resolvedXrayConfig,
    externalInterface: externalInterface ?? "eth0",
    remark: remark ?? null,
  })
```

- [ ] **Step 2: 移除 returning 中的 xrayEnabled**

在 `.returning({...})` 中（约第 158-178 行），删除：

```typescript
// 删除这一行：
xrayEnabled: nodes.xrayEnabled,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "refactor: always generate Reality keys on node creation, remove xrayEnabled"
```

---

### Task 3: 移除 xrayEnabled — 节点更新 API

**Files:**
- Modify: `src/app/api/nodes/[id]/route.ts`

- [ ] **Step 1: 修改 PUT handler**

在 `src/app/api/nodes/[id]/route.ts` 中：

1. 从 body 解构中移除 `xrayEnabled`（第 66 行）：

```typescript
const {
  name,
  ip,
  domain,
  port,
  xrayProtocol,
  xrayTransport,
  xrayPort,
  externalInterface,
  remark,
} = body;
```

2. 删除第 91 行 `if (xrayEnabled !== undefined) updateData.xrayEnabled = xrayEnabled;`

3. 将第 98-131 行的 Reality 密钥生成逻辑改为不依赖 xrayEnabled，改为检查是否有 xrayConfig。如果节点还没有 xrayConfig（旧数据），自动补生成：

```typescript
// 替换第 98-131 行
// Auto-generate Reality keys if node has no xrayConfig (legacy data)
const currentNode = db.select({ xrayConfig: nodes.xrayConfig }).from(nodes).where(eq(nodes.id, nodeId)).get();
let needKeys = true;
if (currentNode?.xrayConfig) {
  try {
    const parsed = JSON.parse(currentNode.xrayConfig);
    if (parsed.realityPublicKey) needKeys = false;
  } catch (e) {
    console.warn(`[nodes/${nodeId}] Failed to parse xrayConfig:`, e);
  }
}
if (needKeys) {
  const realityKeys = generateRealityKeypair();
  const shortId = generateShortId();
  const { realityDest, realityServerName } = normalizeRealityDest(body.realityDest);
  updateData.xrayConfig = JSON.stringify({
    realityPrivateKey: encrypt(realityKeys.privateKey),
    realityPublicKey: realityKeys.publicKey,
    realityShortId: shortId,
    realityDest,
    realityServerName,
  });
  updateData.xrayProtocol = "vless";
  updateData.xrayTransport = "tcp";
} else if (body.realityDest !== undefined) {
  // Update dest/serverName without regenerating keys
  const parsed = JSON.parse(currentNode!.xrayConfig!);
  const normalized = normalizeRealityDest(body.realityDest);
  parsed.realityDest = normalized.realityDest;
  parsed.realityServerName = normalized.realityServerName;
  updateData.xrayConfig = JSON.stringify(parsed);
}
```

- [ ] **Step 2: 移除 GET 和 PUT returning 中的 xrayEnabled**

在 GET handler 的 `.select({...})` 和 PUT handler 的 `.returning({...})` 中，都删除：

```typescript
// 删除这一行：
xrayEnabled: nodes.xrayEnabled,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/nodes/[id]/route.ts
git commit -m "refactor: remove xrayEnabled from node update API, auto-generate keys for legacy nodes"
```

---

### Task 4: 移除 xrayEnabled — Agent 配置下发

**Files:**
- Modify: `src/app/api/agent/config/route.ts:283`

- [ ] **Step 1: 修改 Xray 配置生成条件**

在 `src/app/api/agent/config/route.ts` 第 283 行，将：

```typescript
if (node.xrayEnabled && node.xrayConfig) {
```

改为：

```typescript
if (node.xrayConfig) {
```

- [ ] **Step 2: 检查该文件中是否有其他 xrayEnabled 引用**

Run: `grep -n 'xrayEnabled' src/app/api/agent/config/route.ts`

如果 node select 中有 `xrayEnabled: nodes.xrayEnabled`，也将其删除。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "refactor: check xrayConfig instead of xrayEnabled for agent config"
```

---

### Task 5: 移除 xrayEnabled — 节点列表 API

**Files:**
- Modify: `src/app/api/nodes/route.ts` (GET handler)

- [ ] **Step 1: 移除 GET 返回中的 xrayEnabled**

在 `src/app/api/nodes/route.ts` GET handler 的 `.select({...})` 中（约第 34-57 行），删除：

```typescript
// 删除这一行：
xrayEnabled: nodes.xrayEnabled,
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "refactor: remove xrayEnabled from nodes list API response"
```

---

### Task 6: 移除 xrayEnabled — 前端表单

**Files:**
- Modify: `src/app/(dashboard)/nodes/new/page.tsx`
- Modify: `src/app/(dashboard)/nodes/[id]/page.tsx`

- [ ] **Step 1: 修改新建节点表单**

在 `src/app/(dashboard)/nodes/new/page.tsx` 中：

1. 移除 `Switch` 从 import 中（第 12 行）
2. 移除 `xrayEnabled` state（第 35 行）：`const [xrayEnabled, setXrayEnabled] = useState(false);`
3. 修改 `handleSubmit` 中 body 构造（第 57-69 行），移除 `xrayEnabled`，始终发送 xrayPort 和 realityDest：

```typescript
const body: Record<string, unknown> = {
  name: name.trim(),
  ip: ip.trim(),
  domain: domain.trim() || null,
  port: port ? parseInt(port) : undefined,
  remark: remark.trim() || null,
  externalInterface: externalInterface.trim() || "eth0",
  xrayPort: xrayPort ? parseInt(xrayPort) : null,
  realityDest: realityDest || undefined,
};
```

4. 修改 Xray 设置 Card（第 172-215 行），移除开关和条件渲染：

```tsx
<Card>
  <CardHeader>
    <CardTitle>{t("xraySettings")}</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor="xrayPort">{t("xrayStartPort")}</Label>
      <Input
        id="xrayPort"
        type="number"
        value={xrayPort}
        onChange={(e) => setXrayPort(e.target.value)}
        placeholder={defaults.xray_default_port || "41443"}
      />
      <p className="text-xs text-muted-foreground">
        {t("xrayPortHint", xrayPortHintParams(xrayPort, defaults.xray_default_port))}
      </p>
    </div>
    <div className="space-y-2">
      <Label htmlFor="realityDest">{t("realityTarget")}</Label>
      <Input
        id="realityDest"
        value={realityDest}
        onChange={(e) => setRealityDest(e.target.value)}
        placeholder="www.microsoft.com:443"
      />
      <p className="text-xs text-muted-foreground">
        {t("realityTargetHint")}
      </p>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 2: 修改编辑节点表单**

在 `src/app/(dashboard)/nodes/[id]/page.tsx` 中：

1. 移除 `Switch` 从 import 中（第 12 行）
2. 从 `NodeDetail` 类型中移除 `xrayEnabled`（第 32 行）
3. 移除 `xrayEnabled` state（第 64 行）及 `setXrayEnabled(n.xrayEnabled ?? false)`（第 88 行）
4. 修改 `handleSave` 中 body 构造（第 111-121 行）：

```typescript
const body: Record<string, unknown> = {
  name: name.trim(),
  ip: ip.trim(),
  domain: domain.trim() || null,
  port: port ? parseInt(port) : undefined,
  remark: remark.trim() || null,
  externalInterface: externalInterface.trim() || "eth0",
  xrayPort: xrayPort ? parseInt(xrayPort) : null,
  realityDest: realityDest || undefined,
};
```

5. 修改 Xray 设置区域（第 252-306 行），移除开关和条件渲染，改为带标题的分组：

```tsx
<div className="border-t pt-4 space-y-4">
  <h3 className="font-medium">{tn("xraySettings")}</h3>
  <div className="space-y-2">
    <Label htmlFor="xrayPort">{tn("xrayStartPort")}</Label>
    <Input
      id="xrayPort"
      type="number"
      value={xrayPort}
      onChange={(e) => setXrayPort(e.target.value)}
      placeholder={defaults.xray_default_port || "41443"}
    />
    <p className="text-xs text-muted-foreground">
      {tn("xrayPortHint", xrayPortHintParams(xrayPort, defaults.xray_default_port))}
    </p>
  </div>
  <div className="space-y-2">
    <Label htmlFor="realityDest">{tn("realityTarget")}</Label>
    <Input
      id="realityDest"
      value={realityDest}
      onChange={(e) => setRealityDest(e.target.value)}
      placeholder="www.microsoft.com:443"
    />
    <p className="text-xs text-muted-foreground">
      {tn("realityTargetHint")}
    </p>
  </div>
  {realityPublicKey && (
    <>
      <div className="space-y-2">
        <Label>Reality Public Key</Label>
        <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
          {realityPublicKey}
        </code>
      </div>
      <div className="space-y-2">
        <Label>Reality Short ID</Label>
        <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
          {realityShortId}
        </code>
      </div>
    </>
  )}
</div>
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无 xrayEnabled 相关错误

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/nodes/new/page.tsx src/app/(dashboard)/nodes/[id]/page.tsx
git commit -m "refactor: remove xrayEnabled switch from node forms, always show proxy settings"
```

---

### Task 7: 移除 xrayEnabled — 清理残留引用

**Files:**
- Possibly any file still referencing xrayEnabled

- [ ] **Step 1: 全局搜索残留引用**

Run: `grep -rn 'xrayEnabled\|xray_enabled' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules`

- [ ] **Step 2: 逐一清理每个残留引用**

对于每个引用：
- API route select/returning 中的：删除该行
- 前端类型定义中的：删除该字段
- 其他逻辑中的条件判断：移除条件，保留内部逻辑

- [ ] **Step 3: 验证编译和构建**

Run: `npx tsc --noEmit`
Expected: 无错误

Run: `npm run build 2>&1 | tail -20`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: clean up all remaining xrayEnabled references"
```

---

### Task 8: 国际化 — 更新翻译文案

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: 更新 zh-CN.json**

在 `nodeNew` 命名空间中：

```json
"xraySettings": "Xray / SOCKS5 设置",
```

删除 `"enableXray"` key。

修改 `realityTargetHint`：

```json
"realityTargetHint": "Xray Reality 伪装目标，需支持 TLS 1.3，如 www.microsoft.com:443",
```

在 `nodes` 命名空间中，添加端口列相关 key：

```json
"portsCol": "端口",
"portsCount": "{count} 个端口",
"portsWg": "WG/UDP",
"portsXray": "Xray/TCP",
"portsTunnel": "隧道/UDP",
"portsSocks5": "SOCKS5/TCP"
```

- [ ] **Step 2: 更新 en.json**

在 `nodeNew` 命名空间中：

```json
"xraySettings": "Xray / SOCKS5 Settings",
```

删除 `"enableXray"` key。

修改 `realityTargetHint`：

```json
"realityTargetHint": "Xray Reality camouflage target, must support TLS 1.3, e.g., www.microsoft.com:443",
```

在 `nodes` 命名空间中，添加端口列相关 key：

```json
"portsCol": "Ports",
"portsCount": "{count} ports",
"portsWg": "WG/UDP",
"portsXray": "Xray/TCP",
"portsTunnel": "Tunnel/UDP",
"portsSocks5": "SOCKS5/TCP"
```

- [ ] **Step 3: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git commit -m "i18n: update translations for proxy settings refactor and port column"
```

---

### Task 9: 端口计算 — API 层

**Files:**
- Modify: `src/app/api/nodes/route.ts` (GET handler)

- [ ] **Step 1: 添加端口计算逻辑到 GET handler**

在 `src/app/api/nodes/route.ts` 中，导入所需依赖：

```typescript
import { lineTunnels, lineNodes, devices } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getProxyPortForLine, getXrayDefaultPort } from "@/lib/proxy-port";
```

在 GET handler 中，查询完 `rows` 之后、返回 `paginated()` 之前，添加端口计算：

```typescript
const nodeIds = rows.map((r) => r.id);

// Batch query tunnel ports for all nodes on this page
const tunnelPortRows = nodeIds.length > 0
  ? db
      .select({
        nodeId: lineTunnels.fromNodeId,
        port: lineTunnels.fromWgPort,
      })
      .from(lineTunnels)
      .where(inArray(lineTunnels.fromNodeId, nodeIds))
      .all()
      .concat(
        db
          .select({
            nodeId: lineTunnels.toNodeId,
            port: lineTunnels.toWgPort,
          })
          .from(lineTunnels)
          .where(inArray(lineTunnels.toNodeId, nodeIds))
          .all()
      )
  : [];

// Group tunnel ports by nodeId
const tunnelPortMap = new Map<number, Set<number>>();
for (const row of tunnelPortRows) {
  if (!tunnelPortMap.has(row.nodeId)) tunnelPortMap.set(row.nodeId, new Set());
  tunnelPortMap.get(row.nodeId)!.add(row.port);
}

// Batch query entry line info for SOCKS5 port calculation
const entryLineRows = nodeIds.length > 0
  ? db
      .select({ nodeId: lineNodes.nodeId, lineId: lineNodes.lineId })
      .from(lineNodes)
      .where(and(inArray(lineNodes.nodeId, nodeIds), eq(lineNodes.hopOrder, 0)))
      .all()
  : [];

// Group entry lines by nodeId
const entryLineMap = new Map<number, number[]>();
for (const row of entryLineRows) {
  if (!entryLineMap.has(row.nodeId)) entryLineMap.set(row.nodeId, []);
  entryLineMap.get(row.nodeId)!.push(row.lineId);
}

// Find all lines that have xray or socks5 devices
const allEntryLineIds = [...new Set(entryLineRows.map((r) => r.lineId))];
const proxyDeviceRows = allEntryLineIds.length > 0
  ? db
      .select({ lineId: devices.lineId, protocol: devices.protocol })
      .from(devices)
      .where(
        and(
          inArray(devices.lineId, allEntryLineIds),
          or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))
        )
      )
      .all()
  : [];

const xrayLineIds = new Set(proxyDeviceRows.filter((d) => d.protocol === "xray").map((d) => d.lineId));
const socks5LineIds = new Set(proxyDeviceRows.filter((d) => d.protocol === "socks5").map((d) => d.lineId));

const xrayDefaultPort = getXrayDefaultPort();

// Build ports for each node
const rowsWithPorts = rows.map((row) => {
  const tunnels = [...(tunnelPortMap.get(row.id) ?? [])].sort((a, b) => a - b);
  const nodeEntryLines = entryLineMap.get(row.id) ?? [];
  const basePort = row.xrayPort ?? xrayDefaultPort;

  const hasXray = nodeEntryLines.some((lid) => xrayLineIds.has(lid));

  const socks5Ports: number[] = [];
  for (const lid of nodeEntryLines) {
    if (socks5LineIds.has(lid)) {
      socks5Ports.push(getProxyPortForLine(row.id, lid, "socks5", basePort));
    }
  }

  const xrayPorts: number[] = [];
  for (const lid of nodeEntryLines) {
    if (xrayLineIds.has(lid)) {
      xrayPorts.push(getProxyPortForLine(row.id, lid, "xray", basePort));
    }
  }

  return {
    ...row,
    ports: {
      wg: row.port,
      xray: xrayPorts.sort((a, b) => a - b),
      tunnels,
      socks5: socks5Ports.sort((a, b) => a - b),
    },
  };
});

return paginated(rowsWithPorts, {
  page: params.page,
  pageSize: params.pageSize,
  total,
});
```

将原来的 `return paginated(rows, ...)` 替换为上面的 `return paginated(rowsWithPorts, ...)`。

- [ ] **Step 2: 验证 API 返回**

Run: `npm run dev &` (如果没有在运行)

然后手动验证或用 curl 测试 `/api/nodes` 返回中包含 `ports` 字段。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "feat: compute and return port info for each node in list API"
```

---

### Task 10: 端口列 UI — 添加 Popover 组件

**Files:**
- Create: `src/components/ui/popover.tsx`

- [ ] **Step 1: 创建 Popover 组件**

创建 `src/components/ui/popover.tsx`，使用 Radix UI Popover（已安装 `radix-ui`）：

```tsx
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat: add Popover UI component"
```

---

### Task 11: 端口列 UI — 节点列表页面

**Files:**
- Modify: `src/app/(dashboard)/nodes/page.tsx`

- [ ] **Step 1: 更新 Node 类型定义**

在 `src/app/(dashboard)/nodes/page.tsx` 中，修改 `Node` 类型：

```typescript
type Node = {
  id: number;
  name: string;
  ip: string;
  wgAddress: string;
  status: string;
  ports: {
    wg: number;
    xray: number[];
    tunnels: number[];
    socks5: number[];
  };
};
```

- [ ] **Step 2: 添加 import**

添加 Popover import：

```typescript
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
```

- [ ] **Step 3: 添加端口列到 columns 数组**

在 `columns` 数组中，在 `status` 列之后、`actions` 列之前，添加端口列：

```typescript
{
  key: "ports",
  label: t("portsCol"),
  render: (row) => {
    const node = row as unknown as Node;
    const allPorts = [
      node.ports.wg,
      ...node.ports.xray,
      ...node.ports.tunnels,
      ...node.ports.socks5,
    ];
    const uniqueCount = new Set(allPorts).size;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className="text-sm text-primary hover:underline cursor-pointer">
            {t("portsCount", { count: uniqueCount })}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("portsWg")}</span>
              <span className="font-mono">{node.ports.wg}</span>
            </div>
            {node.ports.xray.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("portsXray")}</span>
                <span className="font-mono">{node.ports.xray.join(", ")}</span>
              </div>
            )}
            {node.ports.tunnels.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("portsTunnel")}</span>
                <span className="font-mono">{node.ports.tunnels.join(", ")}</span>
              </div>
            )}
            {node.ports.socks5.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("portsSocks5")}</span>
                <span className="font-mono">{node.ports.socks5.join(", ")}</span>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  },
},
```

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/nodes/page.tsx
git commit -m "feat: add ports column with popover details to nodes list"
```

---

### Task 12: 最终验证

**Files:** None (verification only)

- [ ] **Step 1: 完整构建验证**

Run: `npm run build 2>&1 | tail -20`
Expected: 构建成功，无错误

- [ ] **Step 2: 全局搜索确认无残留**

Run: `grep -rn 'xrayEnabled\|enableXray' src/ messages/ --include='*.ts' --include='*.tsx' --include='*.json'`
Expected: 无输出

- [ ] **Step 3: 功能验证清单**

手动验证以下场景：
1. 新建节点 — 表单无开关，代理设置始终可见，创建成功
2. 编辑节点 — 表单无开关，Reality 信息正确显示
3. 节点列表 — 端口列显示端口数量，点击弹出分组详情
4. 旧数据兼容 — 已有 xrayEnabled=false 的节点编辑保存后自动补生成 Reality 密钥
