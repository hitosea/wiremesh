# Persistent Proxy Port Allocation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Xray/SOCKS5 proxy ports in the `lines` table so that adding or deleting lines never shifts existing port assignments.

**Architecture:** Add `xray_port` and `socks5_port` nullable integer columns to the `lines` table. Allocate ports at device-creation time (when a line's first Xray/SOCKS5 device is created) by scanning the entry node's occupied ports and picking the first free one from `basePort`. Release ports at device-deletion time (when a line's last Xray/SOCKS5 device is removed). All consumers (agent config, device config, nodes list) read persisted ports instead of computing them.

**Tech Stack:** SQLite (better-sqlite3), Drizzle ORM, Next.js API routes, TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `drizzle/0007_add_proxy_ports.sql` | Create | Migration: add `xray_port` and `socks5_port` to `lines` |
| `drizzle/meta/_journal.json` | Modify | Register migration |
| `src/lib/db/schema.ts:69-75` | Modify | Add columns to `lines` schema |
| `src/lib/proxy-port.ts` | Rewrite | Replace dynamic computation with DB read + allocation helper |
| `src/app/api/devices/route.ts:86-189` | Modify | Allocate port on device creation |
| `src/app/api/devices/[id]/route.ts:98-128` | Modify | Release port on device deletion |
| `src/app/api/agent/config/route.ts:357,410` | Modify | Read persisted port instead of calling `getProxyPortForLine` |
| `src/app/api/devices/[id]/config/route.ts:99,205` | Modify | Read persisted port instead of calling `getProxyPortForLine` |
| `src/app/api/nodes/route.ts:125-153` | Modify | Read persisted ports instead of inline computation |

---

### Task 1: Database Migration

**Files:**
- Create: `drizzle/0007_add_proxy_ports.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts:69-75`

- [ ] **Step 1: Create migration file**

Create `drizzle/0007_add_proxy_ports.sql`:

```sql
ALTER TABLE `lines` ADD `xray_port` integer;--> statement-breakpoint
ALTER TABLE `lines` ADD `socks5_port` integer;
```

- [ ] **Step 2: Register migration in journal**

In `drizzle/meta/_journal.json`, add a new entry to the `entries` array:

```json
{
  "idx": 7,
  "version": "6",
  "when": 1744500000000,
  "tag": "0007_add_proxy_ports",
  "breakpoints": true
}
```

- [ ] **Step 3: Update schema definition**

In `src/lib/db/schema.ts`, modify the `lines` table (line 69-75) from:

```ts
export const lines = sqliteTable("lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  remark: text("remark"),
  ...timestamps,
});
```

to:

```ts
export const lines = sqliteTable("lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  xrayPort: integer("xray_port"),
  socks5Port: integer("socks5_port"),
  remark: text("remark"),
  ...timestamps,
});
```

- [ ] **Step 4: Verify migration runs**

Run: `npm run dev` (or restart dev server) — the server calls `migrate()` on startup. Check the SQLite DB:

```bash
sqlite3 data/wiremesh.db ".schema lines"
```

Expected: table definition includes `xray_port integer` and `socks5_port integer`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0007_add_proxy_ports.sql drizzle/meta/_journal.json src/lib/db/schema.ts
git commit -m "feat: add xray_port and socks5_port columns to lines table"
```

---

### Task 2: Rewrite proxy-port.ts

**Files:**
- Modify: `src/lib/proxy-port.ts` (full rewrite)

- [ ] **Step 1: Replace the file content**

Replace the entire content of `src/lib/proxy-port.ts` with:

```ts
import { db } from "@/lib/db";
import { lines, devices, lineNodes, settings } from "@/lib/db/schema";
import { eq, and, inArray, or, isNotNull } from "drizzle-orm";

export const DEFAULT_PROXY_PORT = 41443;

/** Read xray_default_port from settings, falling back to DEFAULT_PROXY_PORT. */
export function getXrayDefaultPort(): number {
  const row = db.select().from(settings).where(eq(settings.key, "xray_default_port")).get();
  return row?.value ? parseInt(row.value) || DEFAULT_PROXY_PORT : DEFAULT_PROXY_PORT;
}

/**
 * Allocate the next free proxy port for a line on its entry node.
 * Scans all occupied xray_port and socks5_port values on that node,
 * then returns the first unused port starting from basePort.
 */
export function allocateProxyPort(entryNodeId: number, basePort: number): number {
  // Find all lines where this node is the entry (hopOrder=0)
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, entryNodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  if (entryLineIds.length === 0) return basePort;

  // Collect all occupied ports (both xray and socks5) on these lines
  const occupiedRows = db
    .select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
    .from(lines)
    .where(inArray(lines.id, entryLineIds))
    .all();

  const occupied = new Set<number>();
  for (const row of occupiedRows) {
    if (row.xrayPort !== null) occupied.add(row.xrayPort);
    if (row.socks5Port !== null) occupied.add(row.socks5Port);
  }

  // Find first free port
  for (let port = basePort; port < basePort + 100; port++) {
    if (!occupied.has(port)) return port;
  }

  return basePort;
}

// Backwards compatibility aliases
export const DEFAULT_XRAY_PORT = DEFAULT_PROXY_PORT;
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -30`

There will be errors in files that still import `getProxyPortForLine` / `getXrayPortForLine` — that is expected and will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/proxy-port.ts
git commit -m "refactor: rewrite proxy-port.ts with persistent port allocation"
```

---

### Task 3: Allocate port on device creation

**Files:**
- Modify: `src/app/api/devices/route.ts:86-189`

- [ ] **Step 1: Update imports**

At the top of `src/app/api/devices/route.ts`, find the import of `proxy-port` (if any) and ensure these are imported:

```ts
import { allocateProxyPort, getXrayDefaultPort } from "@/lib/proxy-port";
```

Also add `lines` to the schema import if not already present:

```ts
import { nodes, devices, settings, lineNodes, lines } from "@/lib/db/schema";
```

- [ ] **Step 2: Add port allocation after device insert**

After the `const result = db.insert(devices)...get();` block (line 170), and before the `writeAuditLog` call (line 172), add port allocation logic:

```ts
  // Allocate proxy port for the line if this is the first xray/socks5 device
  if (result.lineId && (protocol === "xray" || protocol === "socks5")) {
    const portField = protocol === "xray" ? "xrayPort" : "socks5Port";
    const line = db.select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port }).from(lines).where(eq(lines.id, result.lineId)).get();
    if (line && line[portField] === null) {
      const entryNodeId = getEntryNodeId(result.lineId);
      if (entryNodeId !== null) {
        const nodeRow = db.select({ xrayPort: nodes.xrayPort }).from(nodes).where(eq(nodes.id, entryNodeId)).get();
        const basePort = nodeRow?.xrayPort ?? getXrayDefaultPort();
        const port = allocateProxyPort(entryNodeId, basePort);
        db.update(lines).set({ [portField]: port }).where(eq(lines.id, result.lineId)).run();
      }
    }
  }
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "devices/route"`

Expected: no errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/devices/route.ts
git commit -m "feat: allocate proxy port on device creation"
```

---

### Task 4: Release port on device deletion

**Files:**
- Modify: `src/app/api/devices/[id]/route.ts:98-128`

- [ ] **Step 1: Update imports**

Add to the imports at the top of `src/app/api/devices/[id]/route.ts`:

```ts
import { lines } from "@/lib/db/schema";
```

(The `devices`, `nodes`, `eq` imports should already exist.)

- [ ] **Step 2: Add port release logic after device deletion**

After `db.delete(devices).where(eq(devices.id, deviceId)).run();` (line 110) and before the `writeAuditLog` call (line 112), add:

```ts
  // Release proxy port if this was the last xray/socks5 device on the line
  if (existing.lineId && (existing.protocol === "xray" || existing.protocol === "socks5")) {
    const remaining = db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.lineId, existing.lineId), eq(devices.protocol, existing.protocol)))
      .get();
    if (!remaining) {
      const portField = existing.protocol === "xray" ? "xrayPort" : "socks5Port";
      db.update(lines).set({ [portField]: null }).where(eq(lines.id, existing.lineId)).run();
    }
  }
```

Note: the `existing` query at line 103-104 needs to also fetch `protocol`. Modify line 104 from:

```ts
    .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
```

to:

```ts
    .select({ id: devices.id, name: devices.name, protocol: devices.protocol, lineId: devices.lineId })
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "devices/\[id\]/route"`

Expected: no errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/devices/\[id\]/route.ts
git commit -m "feat: release proxy port on device deletion"
```

---

### Task 5: Update agent config to read persisted ports

**Files:**
- Modify: `src/app/api/agent/config/route.ts:305-410`

- [ ] **Step 1: Remove old imports, add new ones**

Remove `getXrayPortForLine` and `getProxyPortForLine` from the imports. Add `lines` to the schema import if not already present. Ensure `getXrayDefaultPort` is still imported:

```ts
import { getXrayDefaultPort } from "@/lib/proxy-port";
```

- [ ] **Step 2: Batch-query line ports**

Before the Xray routes loop (around line 304), add a batch query for all entry line ports:

```ts
    // Batch-fetch persisted proxy ports for all entry lines
    const linePortRows = entryLineIds.length > 0
      ? db.select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
          .from(lines).where(inArray(lines.id, entryLineIds)).all()
      : [];
    const linePortMap = new Map(linePortRows.map((r) => [r.id, r]));
```

Ensure `inArray` is in the imports from `drizzle-orm`.

- [ ] **Step 3: Replace Xray port computation**

At line 357, replace:

```ts
        port: getXrayPortForLine(nodeId, lineId, xrayBasePort),
```

with:

```ts
        port: linePortMap.get(lineId)?.xrayPort ?? xrayBasePort,
```

- [ ] **Step 4: Replace SOCKS5 port computation**

At line 410, replace:

```ts
      const port = getProxyPortForLine(nodeId, lineId, "socks5", proxyBasePort);
```

with:

```ts
      const port = linePortMap.get(lineId)?.socks5Port ?? proxyBasePort;
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "agent/config"`

Expected: no errors in this file.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "refactor: read persisted proxy ports in agent config"
```

---

### Task 6: Update device config to read persisted ports

**Files:**
- Modify: `src/app/api/devices/[id]/config/route.ts:92-217`

- [ ] **Step 1: Update imports**

Remove `getXrayPortForLine` and `getProxyPortForLine` from imports. Add `lines` to schema import. Keep `getXrayDefaultPort`:

```ts
import { getXrayDefaultPort } from "@/lib/proxy-port";
```

- [ ] **Step 2: Replace Xray port lookup**

At line 98-99, replace:

```ts
    const xrayBasePort = entryNodeRow.nodeXrayPort ?? getXrayDefaultPort();
    const xrayPort = getXrayPortForLine(entryNodeRow.nodeId, device.lineId!, xrayBasePort);
```

with:

```ts
    const lineRow = db.select({ xrayPort: lines.xrayPort }).from(lines).where(eq(lines.id, device.lineId!)).get();
    const xrayPort = lineRow?.xrayPort ?? (entryNodeRow.nodeXrayPort ?? getXrayDefaultPort());
```

- [ ] **Step 3: Replace SOCKS5 port lookup**

At lines 204-205, replace:

```ts
    const basePort = entryNodeRow.nodeXrayPort ?? getXrayDefaultPort();
    const socks5Port = getProxyPortForLine(entryNodeRow.nodeId, device.lineId!, "socks5", basePort);
```

with:

```ts
    const lineRow = db.select({ socks5Port: lines.socks5Port }).from(lines).where(eq(lines.id, device.lineId!)).get();
    const socks5Port = lineRow?.socks5Port ?? (entryNodeRow.nodeXrayPort ?? getXrayDefaultPort());
```

Note: The variable name `lineRow` is used twice in the same function for two different protocol blocks. Since they are in separate `if` blocks, this is fine — each is scoped to its own block.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "devices/\[id\]/config"`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/devices/\[id\]/config/route.ts
git commit -m "refactor: read persisted proxy ports in device config"
```

---

### Task 7: Update nodes list to read persisted ports

**Files:**
- Modify: `src/app/api/nodes/route.ts:94-153`

- [ ] **Step 1: Update imports**

Remove `DEFAULT_PROXY_PORT` from the import if it is no longer used. Keep `getXrayDefaultPort`. Add `lines` to schema import if not present.

- [ ] **Step 2: Replace the inline port computation**

The current approach (lines 94-153) batch-queries `proxyDeviceRows` and computes ports inline. Replace this with reading persisted ports from `lines`.

Remove the batch query for `proxyDeviceRows` (lines 110-126) and the `xrayLineIdsSet` / `socks5LineIdsSet` definitions.

Replace lines 136-143 (inside the `rowsWithPorts` map) from:

```ts
    // Inline port allocation matching getProxyPortForLine logic:
    // Sort by lineId for stable assignment, Xray first then SOCKS5
    const xrayLines = nodeEntryLines.filter((lid) => xrayLineIdsSet.has(lid)).sort((a, b) => a - b);
    const socks5Lines = nodeEntryLines.filter((lid) => socks5LineIdsSet.has(lid)).sort((a, b) => a - b);
    let port = basePort;
    const xrayPorts: number[] = xrayLines.map(() => port++);
    const socks5Ports: number[] = socks5Lines.map(() => port++);
```

with:

```ts
    // Read persisted proxy ports from lines table
    const xrayPorts: number[] = [];
    const socks5Ports: number[] = [];
    for (const lid of nodeEntryLines.sort((a, b) => a - b)) {
      const lp = linePortMap.get(lid);
      if (lp?.xrayPort !== null && lp?.xrayPort !== undefined) xrayPorts.push(lp.xrayPort);
      if (lp?.socks5Port !== null && lp?.socks5Port !== undefined) socks5Ports.push(lp.socks5Port);
    }
```

Add a batch query for line ports before `rowsWithPorts` (alongside the existing batch queries, around line 95):

```ts
  // Batch query proxy ports from lines
  const allEntryLineIdsForPorts = [...new Set(entryLineRows.map((r) => r.lineId))];
  const linePortRows = allEntryLineIdsForPorts.length > 0
    ? db.select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
        .from(lines).where(inArray(lines.id, allEntryLineIdsForPorts)).all()
    : [];
  const linePortMap = new Map(linePortRows.map((r) => [r.id, r]));
```

- [ ] **Step 3: Clean up unused variables**

Remove `proxyDeviceRows`, `xrayLineIdsSet`, `socks5LineIdsSet` definitions and any now-unused imports (`or`).

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep "nodes/route"`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "refactor: read persisted proxy ports in nodes list"
```

---

### Task 8: Clean up proxy-port.ts exports

**Files:**
- Modify: `src/lib/proxy-port.ts`

- [ ] **Step 1: Verify no remaining callers of old functions**

Run:

```bash
grep -r "getProxyPortForLine\|getXrayPortForLine" src/ --include="*.ts"
```

Expected: only `src/lib/proxy-port.ts` (the alias definitions). If any other file still references these, fix it first.

- [ ] **Step 2: Remove dead exports**

Remove the `DEFAULT_XRAY_PORT` alias and any leftover `getProxyPortForLine` / `getXrayPortForLine` function definitions from `src/lib/proxy-port.ts` since they are no longer called.

The final file should only contain:
- `DEFAULT_PROXY_PORT`
- `getXrayDefaultPort()`
- `allocateProxyPort()`

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/proxy-port.ts
git commit -m "chore: remove unused proxy port functions"
```

---

### Task 9: Backfill existing data

Existing lines in the database have `xray_port = NULL` and `socks5_port = NULL`. After deploying the code, agent configs will fall back to `basePort` for all lines (the `?? basePort` fallback). We need a one-time backfill.

**Files:**
- Modify: `drizzle/0007_add_proxy_ports.sql` (extend migration)

- [ ] **Step 1: Extend the migration**

This is simplest done as application-level logic on startup. Add a backfill function in `src/lib/proxy-port.ts`:

```ts
/**
 * One-time backfill: assign ports to existing lines that have xray/socks5
 * devices but no persisted port yet.
 */
export function backfillProxyPorts(): void {
  // Find all lines with xray devices but no xrayPort
  const xrayLines = db
    .select({ lineId: devices.lineId })
    .from(devices)
    .where(and(eq(devices.protocol, "xray"), isNotNull(devices.lineId)))
    .all()
    .map((r) => r.lineId!);
  const uniqueXrayLineIds = [...new Set(xrayLines)];

  for (const lineId of uniqueXrayLineIds) {
    const line = db.select({ xrayPort: lines.xrayPort }).from(lines).where(eq(lines.id, lineId)).get();
    if (line && line.xrayPort === null) {
      const entryNodeRow = db
        .select({ nodeId: lineNodes.nodeId })
        .from(lineNodes)
        .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.hopOrder, 0)))
        .get();
      if (entryNodeRow) {
        const nodeRow = db.select({ xrayPort: nodes.xrayPort }).from(nodes).where(eq(nodes.id, entryNodeRow.nodeId)).get();
        const basePort = nodeRow?.xrayPort ?? getXrayDefaultPort();
        const port = allocateProxyPort(entryNodeRow.nodeId, basePort);
        db.update(lines).set({ xrayPort: port }).where(eq(lines.id, lineId)).run();
      }
    }
  }

  // Same for socks5
  const socks5Lines = db
    .select({ lineId: devices.lineId })
    .from(devices)
    .where(and(eq(devices.protocol, "socks5"), isNotNull(devices.lineId)))
    .all()
    .map((r) => r.lineId!);
  const uniqueSocks5LineIds = [...new Set(socks5Lines)];

  for (const lineId of uniqueSocks5LineIds) {
    const line = db.select({ socks5Port: lines.socks5Port }).from(lines).where(eq(lines.id, lineId)).get();
    if (line && line.socks5Port === null) {
      const entryNodeRow = db
        .select({ nodeId: lineNodes.nodeId })
        .from(lineNodes)
        .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.hopOrder, 0)))
        .get();
      if (entryNodeRow) {
        const nodeRow = db.select({ xrayPort: nodes.xrayPort }).from(nodes).where(eq(nodes.id, entryNodeRow.nodeId)).get();
        const basePort = nodeRow?.xrayPort ?? getXrayDefaultPort();
        const port = allocateProxyPort(entryNodeRow.nodeId, basePort);
        db.update(lines).set({ socks5Port: port }).where(eq(lines.id, lineId)).run();
      }
    }
  }
}
```

- [ ] **Step 2: Call backfill on DB initialization**

In `src/lib/db/index.ts`, after the `migrate()` call (line 28), add:

```ts
  // Backfill proxy ports for existing lines (idempotent — skips lines that already have ports)
  const { backfillProxyPorts } = require("@/lib/proxy-port");
  backfillProxyPorts();
```

Use `require` instead of top-level `import` to avoid circular dependency (proxy-port.ts imports from db).

- [ ] **Step 3: Verify backfill works**

Restart the dev server and check:

```bash
sqlite3 data/wiremesh.db "SELECT id, name, xray_port, socks5_port FROM lines"
```

Expected: all lines with Xray/SOCKS5 devices have non-null port values. Lines without those device types have null.

- [ ] **Step 4: Commit**

```bash
git add src/lib/proxy-port.ts src/lib/db/index.ts
git commit -m "feat: backfill proxy ports for existing lines on startup"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Restart dev server and verify port assignments**

```bash
# Check lines have ports
sqlite3 data/wiremesh.db "SELECT id, name, xray_port, socks5_port FROM lines"
```

- [ ] **Step 2: Test port stability — add a new line with Xray device**

```bash
# Record current SOCKS5 configs
curl -s -b /tmp/wm_cookies "https://3456--main--apang--kuaifan.coder.dootask.com/api/devices/22/config" | jq '.data.proxyUrl'

# Create a new line + Xray device via API
# Then re-check — the SOCKS5 URL above must be identical
```

- [ ] **Step 3: Test port reuse — delete a line and create a new one**

Delete a line via API, verify its port values are gone. Create a new line + device, verify it reuses the freed port.

- [ ] **Step 4: Run full e2e test**

Use `/e2e-test` skill to verify all protocols still work end-to-end.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address any issues found during e2e verification"
```
