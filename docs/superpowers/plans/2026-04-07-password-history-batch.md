# 修改密码 UI + 节点状态历史图表 + 批量操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three missing features: password change UI in settings, node status history charts, and batch operations for nodes/devices.

**Architecture:** All three are frontend-heavy. Password change adds a Card to the existing settings page. History chart installs recharts and adds a chart component to the node detail page. Batch operations extend the DataTable component with checkbox selection, then add batch API endpoints and batch action bars to nodes/devices list pages.

**Tech Stack:** React 18, TypeScript, shadcn/ui (Card, Input, Button, Checkbox, Dialog), recharts (new dependency), Drizzle ORM, Next.js App Router API routes.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/app/(dashboard)/settings/page.tsx` | Modify | Add password change Card at bottom |
| `src/app/(dashboard)/nodes/[id]/page.tsx` | Modify | Add status history chart section |
| `src/components/node-status-chart.tsx` | Create | Recharts line chart for latency/traffic |
| `src/components/data-table.tsx` | Modify | Add optional checkbox selection support |
| `src/app/api/nodes/batch/route.ts` | Create | Batch delete + batch update tags for nodes |
| `src/app/api/devices/batch/route.ts` | Create | Batch delete + batch switch line for devices |
| `src/app/(dashboard)/nodes/page.tsx` | Modify | Add checkbox selection + batch action bar |
| `src/app/(dashboard)/devices/page.tsx` | Modify | Add checkbox selection + batch action bar |

---

## Task 1: Password Change UI

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Add password change state and handler to settings page**

Add the following state variables and handler after the existing `handleSave` function (around line 87), and add the password change Card after the existing SETTING_GROUPS map (around line 127), inside the same `<div className="space-y-6">`:

```tsx
// Add these state variables inside SettingsPage(), after the existing state (line 52)
const [currentPassword, setCurrentPassword] = useState("");
const [newPassword, setNewPassword] = useState("");
const [confirmPassword, setConfirmPassword] = useState("");
const [changingPassword, setChangingPassword] = useState(false);

// Add this handler after handleSave (line 87)
const handleChangePassword = async () => {
  if (!currentPassword || !newPassword) {
    toast.error("请填写当前密码和新密码");
    return;
  }
  if (newPassword.length < 6) {
    toast.error("新密码至少需要 6 位字符");
    return;
  }
  if (newPassword !== confirmPassword) {
    toast.error("两次输入的新密码不一致");
    return;
  }
  setChangingPassword(true);
  try {
    const res = await fetch("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) {
      toast.success("密码已更新");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      const json = await res.json();
      toast.error(json.error?.message ?? "密码修改失败");
    }
  } catch {
    toast.error("密码修改失败，请重试");
  } finally {
    setChangingPassword(false);
  }
};
```

Add this JSX right before the closing `</div>` of the return (line 128), after the SETTING_GROUPS map:

```tsx
<Card>
  <CardHeader>
    <CardTitle>修改密码</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4 max-w-md">
    <div className="space-y-1">
      <Label htmlFor="currentPassword">当前密码</Label>
      <Input
        id="currentPassword"
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
    </div>
    <div className="space-y-1">
      <Label htmlFor="newPassword">新密码</Label>
      <Input
        id="newPassword"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="至少 6 位字符"
      />
    </div>
    <div className="space-y-1">
      <Label htmlFor="confirmPassword">确认新密码</Label>
      <Input
        id="confirmPassword"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
    </div>
    <Button onClick={handleChangePassword} disabled={changingPassword}>
      {changingPassword ? "修改中..." : "修改密码"}
    </Button>
  </CardContent>
</Card>
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: add password change UI to settings page"
```

---

## Task 2: Install recharts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install recharts**

Run: `cd /home/coder/workspaces/wiremesh && npm install recharts`

- [ ] **Step 2: Verify installation**

Run: `node -e "require('recharts')"`
Expected: No error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add recharts dependency for node status charts"
```

---

## Task 3: Node Status History Chart Component

**Files:**
- Create: `src/components/node-status-chart.tsx`

The existing API `GET /api/nodes/:id/status` returns paginated data from `node_status` table with fields: `isOnline`, `latency`, `uploadBytes`, `downloadBytes`, `checkedAt`. We'll fetch the latest 100 data points (no need for pagination controls on the chart) and display latency as a line chart and traffic as an area chart.

- [ ] **Step 1: Create the chart component**

Create `src/components/node-status-chart.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type StatusRecord = {
  isOnline: boolean;
  latency: number | null;
  uploadBytes: number;
  downloadBytes: number;
  checkedAt: string;
};

type ChartPoint = {
  time: string;
  latency: number | null;
  upload: number;
  download: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr + "Z");
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function NodeStatusChart({ nodeId }: { nodeId: string }) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/nodes/${nodeId}/status?page=1&pageSize=100`)
      .then((res) => res.json())
      .then((json) => {
        const rows: StatusRecord[] = json.data ?? [];
        const points: ChartPoint[] = rows
          .reverse()
          .map((r) => ({
            time: formatTime(r.checkedAt),
            latency: r.latency,
            upload: r.uploadBytes,
            download: r.downloadBytes,
          }));
        setData(points);
      })
      .catch(() => toast.error("加载状态历史失败"))
      .finally(() => setLoading(false));
  }, [nodeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>状态历史</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">暂无历史数据</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>延迟 (ms)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="latency"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>流量</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={formatBytes} />
              <Tooltip formatter={(value: number) => formatBytes(value)} />
              <Area
                type="monotone"
                dataKey="upload"
                name="上行"
                stroke="hsl(210, 80%, 55%)"
                fill="hsl(210, 80%, 55%)"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="download"
                name="下行"
                stroke="hsl(150, 60%, 45%)"
                fill="hsl(150, 60%, 45%)"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add chart to node detail page**

In `src/app/(dashboard)/nodes/[id]/page.tsx`:

Add the import at the top (after existing imports):
```tsx
import { NodeStatusChart } from "@/components/node-status-chart";
```

Add the chart section after the "编辑节点" Card (before the `<div className="flex gap-2">` buttons at the bottom, around line 303):

```tsx
{/* Status History */}
<NodeStatusChart nodeId={nodeId} />
```

Also remove the `max-w-2xl` constraint from the outer div (line 156) so the charts have enough width. Change:
```tsx
<div className="space-y-6 max-w-2xl">
```
to:
```tsx
<div className="space-y-6">
```

And wrap the existing edit form part in a `max-w-2xl` div. The structure becomes:
```tsx
<div className="space-y-6">
  {/* Header with name + badge + back button — keep as-is */}
  
  <div className="max-w-2xl space-y-6">
    {/* "节点信息" Card — keep as-is */}
    {/* "编辑节点" Card — keep as-is */}
    {/* Save/Back buttons — keep as-is */}
  </div>

  {/* Status History — full width */}
  <NodeStatusChart nodeId={nodeId} />
</div>
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/node-status-chart.tsx src/app/\(dashboard\)/nodes/\[id\]/page.tsx
git commit -m "feat: add node status history charts (latency + traffic)"
```

---

## Task 4: Extend DataTable with Checkbox Selection

**Files:**
- Modify: `src/components/data-table.tsx`

The DataTable is used by nodes, devices, lines, and filters pages. We'll add optional selection support: a checkbox column, `selectedIds` state, and an `onSelectionChange` callback. Pages that don't pass `selectable` prop are unaffected.

- [ ] **Step 1: Add selection props and checkbox column to DataTable**

In `src/components/data-table.tsx`:

Add Checkbox import at the top:
```tsx
import { Checkbox } from "@/components/ui/checkbox";
```

Extend the `DataTableProps` interface — add these optional props:
```tsx
interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
  getRowId?: (row: T) => number;
}
```

Add the new props to the destructured params:
```tsx
export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  pagination,
  onPageChange,
  onSearch,
  searchPlaceholder = "搜索...",
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  getRowId = (row) => row.id as number,
}: DataTableProps<T>) {
```

In the `<TableHeader>`, add a select-all checkbox before existing headers:
```tsx
<TableRow>
  {selectable && (
    <TableHead className="w-12">
      <Checkbox
        checked={data.length > 0 && data.every((row) => selectedIds.has(getRowId(row)))}
        onCheckedChange={(checked) => {
          if (checked) {
            onSelectionChange?.(new Set([...selectedIds, ...data.map(getRowId)]));
          } else {
            const pageIds = new Set(data.map(getRowId));
            onSelectionChange?.(new Set([...selectedIds].filter((id) => !pageIds.has(id))));
          }
        }}
      />
    </TableHead>
  )}
  {columns.map((col) => (
    <TableHead key={col.key}>{col.label}</TableHead>
  ))}
</TableRow>
```

In the `<TableBody>` data rows (inside the `.map`), add a checkbox cell before existing cells:
```tsx
data.map((row, idx) => (
  <TableRow key={idx}>
    {selectable && (
      <TableCell>
        <Checkbox
          checked={selectedIds.has(getRowId(row))}
          onCheckedChange={(checked) => {
            const next = new Set(selectedIds);
            if (checked) {
              next.add(getRowId(row));
            } else {
              next.delete(getRowId(row));
            }
            onSelectionChange?.(next);
          }}
        />
      </TableCell>
    )}
    {columns.map((col) => (
      <TableCell key={col.key}>
        {col.render ? col.render(row) : (row[col.key] as ReactNode)}
      </TableCell>
    ))}
  </TableRow>
))
```

In the empty data row, update the colSpan to account for the checkbox column:
```tsx
<TableCell
  colSpan={columns.length + (selectable ? 1 : 0)}
  className="h-24 text-center text-muted-foreground"
>
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds. Existing pages (which don't pass `selectable`) are unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/components/data-table.tsx
git commit -m "feat: add optional checkbox selection to DataTable component"
```

---

## Task 5: Batch API for Nodes

**Files:**
- Create: `src/app/api/nodes/batch/route.ts`

The requirements say: batch delete + batch update tags for nodes. We'll use a single POST endpoint with an `action` field.

- [ ] **Step 1: Create batch API endpoint**

Create `src/app/api/nodes/batch/route.ts`:

```ts
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sql } from "drizzle-orm";

export async function POST(request: Request) {
  const body = await request.json();
  const { action, ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error("VALIDATION_ERROR", "请选择至少一个节点");
  }

  if (action === "delete") {
    const existing = db
      .select({ id: nodes.id, name: nodes.name })
      .from(nodes)
      .where(inArray(nodes.id, ids))
      .all();

    db.delete(nodes).where(inArray(nodes.id, ids)).run();

    for (const node of existing) {
      writeAuditLog({
        action: "delete",
        targetType: "node",
        targetId: node.id,
        targetName: node.name,
        detail: "批量删除",
      });
    }

    return success({ message: `已删除 ${existing.length} 个节点` });
  }

  if (action === "updateTags") {
    const { tags } = body;
    if (typeof tags !== "string") {
      return error("VALIDATION_ERROR", "标签不能为空");
    }

    db.update(nodes)
      .set({ tags: tags || null, updatedAt: sql`(datetime('now'))` })
      .where(inArray(nodes.id, ids))
      .run();

    for (const id of ids) {
      writeAuditLog({
        action: "update",
        targetType: "node",
        targetId: id,
        detail: `批量更新标签: ${tags}`,
      });
    }

    return success({ message: `已更新 ${ids.length} 个节点的标签` });
  }

  return error("VALIDATION_ERROR", "无效的操作类型");
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/nodes/batch/route.ts
git commit -m "feat: add batch delete and update tags API for nodes"
```

---

## Task 6: Batch API for Devices

**Files:**
- Create: `src/app/api/devices/batch/route.ts`

The requirements say: batch delete + batch switch line for devices. Same pattern as nodes.

- [ ] **Step 1: Create batch API endpoint**

Create `src/app/api/devices/batch/route.ts`:

```ts
import { db } from "@/lib/db";
import { devices, lines, lineNodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { inArray, eq, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";
import { sql } from "drizzle-orm";

function getEntryNodeId(lineId: number): number | null {
  const entry = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry"))).get();
  return entry?.nodeId ?? null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action, ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error("VALIDATION_ERROR", "请选择至少一个设备");
  }

  if (action === "delete") {
    const existing = db
      .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
      .from(devices)
      .where(inArray(devices.id, ids))
      .all();

    // Collect affected entry nodes for SSE notification
    const affectedEntryNodeIds = new Set<number>();
    for (const device of existing) {
      if (device.lineId) {
        const entryNodeId = getEntryNodeId(device.lineId);
        if (entryNodeId !== null) affectedEntryNodeIds.add(entryNodeId);
      }
    }

    db.delete(devices).where(inArray(devices.id, ids)).run();

    for (const device of existing) {
      writeAuditLog({
        action: "delete",
        targetType: "device",
        targetId: device.id,
        targetName: device.name,
        detail: "批量删除",
      });
    }

    // Notify affected entry nodes
    for (const nodeId of affectedEntryNodeIds) {
      sseManager.notifyNodePeerUpdate(nodeId);
    }

    return success({ message: `已删除 ${existing.length} 个设备` });
  }

  if (action === "switchLine") {
    const { lineId } = body;

    // lineId can be null (unbind from line)
    if (lineId !== null) {
      const line = db.select({ id: lines.id }).from(lines).where(eq(lines.id, lineId)).get();
      if (!line) return error("NOT_FOUND", "线路不存在");
    }

    // Get old line IDs for SSE notifications
    const existing = db
      .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
      .from(devices)
      .where(inArray(devices.id, ids))
      .all();

    const affectedEntryNodeIds = new Set<number>();
    for (const device of existing) {
      if (device.lineId) {
        const entryNodeId = getEntryNodeId(device.lineId);
        if (entryNodeId !== null) affectedEntryNodeIds.add(entryNodeId);
      }
    }

    db.update(devices)
      .set({ lineId: lineId, updatedAt: sql`(datetime('now'))` })
      .where(inArray(devices.id, ids))
      .run();

    // Notify new line's entry node too
    if (lineId !== null) {
      const entryNodeId = getEntryNodeId(lineId);
      if (entryNodeId !== null) affectedEntryNodeIds.add(entryNodeId);
    }

    for (const device of existing) {
      writeAuditLog({
        action: "update",
        targetType: "device",
        targetId: device.id,
        targetName: device.name,
        detail: lineId ? `批量切换线路: ${lineId}` : "批量取消线路绑定",
      });
    }

    for (const nodeId of affectedEntryNodeIds) {
      sseManager.notifyNodePeerUpdate(nodeId);
    }

    return success({ message: `已更新 ${ids.length} 个设备的线路` });
  }

  return error("VALIDATION_ERROR", "无效的操作类型");
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/devices/batch/route.ts
git commit -m "feat: add batch delete and switch line API for devices"
```

---

## Task 7: Batch Operations UI for Nodes Page

**Files:**
- Modify: `src/app/(dashboard)/nodes/page.tsx`

- [ ] **Step 1: Add selection state, batch handlers, and batch action bar**

In `src/app/(dashboard)/nodes/page.tsx`:

Add import for `Input` at top:
```tsx
import { Input } from "@/components/ui/input";
```

Add selection state after existing state variables (around line 55):
```tsx
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [batchDeleting, setBatchDeleting] = useState(false);
const [showBatchDelete, setShowBatchDelete] = useState(false);
const [showBatchTags, setShowBatchTags] = useState(false);
const [batchTags, setBatchTags] = useState("");
const [batchUpdating, setBatchUpdating] = useState(false);
```

Add batch delete handler after existing `handleDelete` function:
```tsx
const handleBatchDelete = async () => {
  setBatchDeleting(true);
  try {
    const res = await fetch("/api/nodes/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: [...selectedIds] }),
    });
    const json = await res.json();
    if (res.ok) {
      toast.success(json.data.message);
      setSelectedIds(new Set());
      setShowBatchDelete(false);
      fetchNodes(pagination.page);
    } else {
      toast.error(json.error?.message ?? "批量删除失败");
    }
  } catch {
    toast.error("批量删除失败，请重试");
  } finally {
    setBatchDeleting(false);
  }
};

const handleBatchUpdateTags = async () => {
  setBatchUpdating(true);
  try {
    const res = await fetch("/api/nodes/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateTags", ids: [...selectedIds], tags: batchTags }),
    });
    const json = await res.json();
    if (res.ok) {
      toast.success(json.data.message);
      setSelectedIds(new Set());
      setShowBatchTags(false);
      setBatchTags("");
      fetchNodes(pagination.page);
    } else {
      toast.error(json.error?.message ?? "批量更新失败");
    }
  } catch {
    toast.error("批量更新失败，请重试");
  } finally {
    setBatchUpdating(false);
  }
};
```

Add batch action bar after the header `<div>` (after line 177 `</div>`, before the loading check), and pass selection props to DataTable:

```tsx
{selectedIds.size > 0 && (
  <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
    <span className="text-sm font-medium">已选择 {selectedIds.size} 项</span>
    <Button size="sm" variant="outline" onClick={() => setShowBatchTags(true)}>
      批量更新标签
    </Button>
    <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
      批量删除
    </Button>
    <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
      取消选择
    </Button>
  </div>
)}
```

Update the `<DataTable>` to pass selection props:
```tsx
<DataTable
  data={data as unknown as Record<string, unknown>[]}
  columns={columns as Column<Record<string, unknown>>[]}
  pagination={pagination}
  onPageChange={handlePageChange}
  onSearch={handleSearch}
  searchPlaceholder="搜索节点名称或 IP..."
  selectable
  selectedIds={selectedIds}
  onSelectionChange={setSelectedIds}
/>
```

Add batch delete dialog and batch tags dialog after the existing delete dialog (before the closing `</div>` of the return):

```tsx
<Dialog open={showBatchDelete} onOpenChange={() => setShowBatchDelete(false)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>批量删除</DialogTitle>
    </DialogHeader>
    <p className="text-muted-foreground">
      确定要删除选中的 {selectedIds.size} 个节点吗？此操作不可恢复。
    </p>
    <div className="flex justify-end gap-2 mt-4">
      <Button variant="outline" onClick={() => setShowBatchDelete(false)}>
        取消
      </Button>
      <Button
        variant="destructive"
        onClick={handleBatchDelete}
        disabled={batchDeleting}
      >
        {batchDeleting ? "删除中..." : "确认删除"}
      </Button>
    </div>
  </DialogContent>
</Dialog>

<Dialog open={showBatchTags} onOpenChange={() => setShowBatchTags(false)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>批量更新标签</DialogTitle>
    </DialogHeader>
    <p className="text-muted-foreground text-sm mb-2">
      将为选中的 {selectedIds.size} 个节点设置以下标签（逗号分隔，留空清除标签）：
    </p>
    <Input
      value={batchTags}
      onChange={(e) => setBatchTags(e.target.value)}
      placeholder="例如：香港,高速"
    />
    <div className="flex justify-end gap-2 mt-4">
      <Button variant="outline" onClick={() => setShowBatchTags(false)}>
        取消
      </Button>
      <Button onClick={handleBatchUpdateTags} disabled={batchUpdating}>
        {batchUpdating ? "更新中..." : "确认更新"}
      </Button>
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/nodes/page.tsx
git commit -m "feat: add batch delete and update tags UI for nodes"
```

---

## Task 8: Batch Operations UI for Devices Page

**Files:**
- Modify: `src/app/(dashboard)/devices/page.tsx`

- [ ] **Step 1: Add selection state, line picker, and batch handlers**

In `src/app/(dashboard)/devices/page.tsx`:

Add imports at top:
```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

Add a Line type after the existing Device type:
```tsx
type LineOption = {
  id: number;
  name: string;
};
```

Add selection state after existing state variables (around line 66):
```tsx
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [batchDeleting, setBatchDeleting] = useState(false);
const [showBatchDelete, setShowBatchDelete] = useState(false);
const [showBatchLine, setShowBatchLine] = useState(false);
const [batchLineId, setBatchLineId] = useState<string>("");
const [batchSwitching, setBatchSwitching] = useState(false);
const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
```

Add a fetch function for line options (used in the batch switch dialog), after the existing `fetchDevices` function:
```tsx
const fetchLineOptions = async () => {
  try {
    const res = await fetch("/api/lines?page=1&pageSize=100");
    const json = await res.json();
    setLineOptions((json.data ?? []).map((l: { id: number; name: string }) => ({ id: l.id, name: l.name })));
  } catch {
    // ignore
  }
};
```

Add batch handlers after existing `handleDelete`:
```tsx
const handleBatchDelete = async () => {
  setBatchDeleting(true);
  try {
    const res = await fetch("/api/devices/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: [...selectedIds] }),
    });
    const json = await res.json();
    if (res.ok) {
      toast.success(json.data.message);
      setSelectedIds(new Set());
      setShowBatchDelete(false);
      fetchDevices(pagination.page);
    } else {
      toast.error(json.error?.message ?? "批量删除失败");
    }
  } catch {
    toast.error("批量删除失败，请重试");
  } finally {
    setBatchDeleting(false);
  }
};

const handleBatchSwitchLine = async () => {
  setBatchSwitching(true);
  try {
    const lineId = batchLineId === "none" ? null : parseInt(batchLineId);
    const res = await fetch("/api/devices/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switchLine", ids: [...selectedIds], lineId }),
    });
    const json = await res.json();
    if (res.ok) {
      toast.success(json.data.message);
      setSelectedIds(new Set());
      setShowBatchLine(false);
      setBatchLineId("");
      fetchDevices(pagination.page);
    } else {
      toast.error(json.error?.message ?? "批量切换失败");
    }
  } catch {
    toast.error("批量切换失败，请重试");
  } finally {
    setBatchSwitching(false);
  }
};
```

Add batch action bar after the header `<div>`, before the loading check:

```tsx
{selectedIds.size > 0 && (
  <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
    <span className="text-sm font-medium">已选择 {selectedIds.size} 项</span>
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        fetchLineOptions();
        setShowBatchLine(true);
      }}
    >
      批量切换线路
    </Button>
    <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
      批量删除
    </Button>
    <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
      取消选择
    </Button>
  </div>
)}
```

Update the `<DataTable>` to pass selection props:
```tsx
<DataTable
  data={data as unknown as Record<string, unknown>[]}
  columns={columns as Column<Record<string, unknown>>[]}
  pagination={pagination}
  onPageChange={handlePageChange}
  onSearch={handleSearch}
  searchPlaceholder="搜索设备名称..."
  selectable
  selectedIds={selectedIds}
  onSelectionChange={setSelectedIds}
/>
```

Add batch dialogs after the existing delete dialog:

```tsx
<Dialog open={showBatchDelete} onOpenChange={() => setShowBatchDelete(false)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>批量删除</DialogTitle>
    </DialogHeader>
    <p className="text-muted-foreground">
      确定要删除选中的 {selectedIds.size} 个设备吗？此操作不可恢复。
    </p>
    <div className="flex justify-end gap-2 mt-4">
      <Button variant="outline" onClick={() => setShowBatchDelete(false)}>
        取消
      </Button>
      <Button
        variant="destructive"
        onClick={handleBatchDelete}
        disabled={batchDeleting}
      >
        {batchDeleting ? "删除中..." : "确认删除"}
      </Button>
    </div>
  </DialogContent>
</Dialog>

<Dialog open={showBatchLine} onOpenChange={() => setShowBatchLine(false)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>批量切换线路</DialogTitle>
    </DialogHeader>
    <p className="text-muted-foreground text-sm mb-2">
      为选中的 {selectedIds.size} 个设备切换线路：
    </p>
    <Select value={batchLineId} onValueChange={setBatchLineId}>
      <SelectTrigger>
        <SelectValue placeholder="选择线路" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">无（取消绑定）</SelectItem>
        {lineOptions.map((line) => (
          <SelectItem key={line.id} value={String(line.id)}>
            {line.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <div className="flex justify-end gap-2 mt-4">
      <Button variant="outline" onClick={() => setShowBatchLine(false)}>
        取消
      </Button>
      <Button
        onClick={handleBatchSwitchLine}
        disabled={batchSwitching || !batchLineId}
      >
        {batchSwitching ? "切换中..." : "确认切换"}
      </Button>
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/devices/page.tsx
git commit -m "feat: add batch delete and switch line UI for devices"
```

---

## Summary

| Task | Feature | Files Changed |
|------|---------|--------------|
| 1 | Password change UI | settings/page.tsx |
| 2 | Install recharts | package.json |
| 3 | Node status history chart | node-status-chart.tsx, nodes/[id]/page.tsx |
| 4 | DataTable checkbox selection | data-table.tsx |
| 5 | Node batch API | api/nodes/batch/route.ts |
| 6 | Device batch API | api/devices/batch/route.ts |
| 7 | Node batch UI | nodes/page.tsx |
| 8 | Device batch UI | devices/page.tsx |
