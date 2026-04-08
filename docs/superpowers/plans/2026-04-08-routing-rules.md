# Routing Rules (分流规则) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement multi-branch line topology with IP/CIDR and domain-based traffic routing, including Agent-side DNS proxy and external rule sources.

**Architecture:** Lines expand from single-chain to star topology (one entry + multiple branches). Each branch has its own relay/exit chain. Filters map destination CIDRs and domains to branches. Agent applies routing via ip rule/iptables/ipset and an embedded DNS proxy (miekg/dns). External rule sources are fetched by the Agent on a timer.

**Tech Stack:** Next.js (App Router) + Drizzle ORM + SQLite, Go Agent with miekg/dns, iptables/ipset/ip-rule for Linux routing.

**Design Spec:** `docs/superpowers/specs/2026-04-08-routing-rules-design.md`

---

## File Structure

### Management Platform (Next.js)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/db/schema.ts` | Modify | Add `lineBranches`, `branchFilters` tables; add `branchId` to `lineNodes`/`lineTunnels`; add `domainRules`/`sourceUrl`/`sourceUpdatedAt` to `filters`; remove `lineFilters` |
| `src/app/api/lines/route.ts` | Modify | POST: accept `branches[]` instead of flat `nodeIds[]`; create branches + branch-scoped tunnels |
| `src/app/api/lines/[id]/route.ts` | Modify | GET: return branches with their nodes/filters; PUT: update branches; DELETE: unchanged (cascade) |
| `src/app/api/filters/route.ts` | Modify | POST: accept `domainRules`, `sourceUrl`, `branchIds` instead of `lineIds` |
| `src/app/api/filters/[id]/route.ts` | Modify | GET: return associated branches; PUT: accept `domainRules`, `sourceUrl`, `branchIds` |
| `src/app/api/filters/[id]/sync/route.ts` | Create | POST: trigger external source sync via SSE notification to Agent |
| `src/app/api/agent/config/route.ts` | Modify | Add `routing` section to config response for entry nodes |
| `src/app/(dashboard)/lines/new/page.tsx` | Modify | Multi-branch UI: entry node + branch cards with relay/exit/filters |
| `src/app/(dashboard)/lines/[id]/page.tsx` | Modify | Display branch topology; edit branches |
| `src/app/(dashboard)/filters/new/page.tsx` | Modify | Add domain_rules textarea, source_url input, branch association |
| `src/app/(dashboard)/filters/[id]/page.tsx` | Modify | Same as new page but for editing |
| `src/app/(dashboard)/filters/page.tsx` | Modify | Add rules_count and branch_count columns |
| `src/app/(dashboard)/settings/page.tsx` | Modify | Add `filter_sync_interval` and `dns_upstream` settings |

### Agent (Go)

| File | Action | Responsibility |
|------|--------|----------------|
| `agent/api/config_types.go` | Modify | Add `RoutingConfig`, `RoutingBranch`, `RuleSource` types; update `ConfigData` |
| `agent/wg/routing.go` | Modify | Add `SyncBranchRouting()` for fwmark-based branch routing; update constants to 41xxx/42xxx |
| `agent/iptables/rules.go` | Modify | Add mangle table support for PREROUTING chain; add ipset match rules |
| `agent/ipset/ipset.go` | Create | ipset create/flush/add/destroy wrappers |
| `agent/dns/proxy.go` | Create | DNS forwarding proxy using miekg/dns with domain matching and ipset integration |
| `agent/dns/rules.go` | Create | Domain rule matching logic (exact + suffix) |
| `agent/routing/manager.go` | Create | Orchestrates branch routing: ip rules, iptables mangle, ipset, DNS proxy lifecycle |
| `agent/routing/sync.go` | Create | External rule source fetcher with timer |
| `agent/agent/agent.go` | Modify | Integrate routing manager into lifecycle (start/stop/sync) |
| `agent/go.mod` | Modify | Add `github.com/miekg/dns` dependency |

---

## Task 1: Database Schema Changes

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add `lineBranches` table to schema**

```typescript
// Add after lineTunnels table definition in schema.ts

// ===== line_branches =====
export const lineBranches = sqliteTable("line_branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id").notNull().references(() => lines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});
```

- [ ] **Step 2: Add `branchId` to `lineNodes` table**

Add nullable `branchId` field to the existing `lineNodes` table definition:

```typescript
// In the lineNodes table, add after lineId:
branchId: integer("branch_id").references(() => lineBranches.id, { onDelete: "cascade" }),
```

- [ ] **Step 3: Add `branchId` to `lineTunnels` table**

Add nullable `branchId` field to the existing `lineTunnels` table definition:

```typescript
// In the lineTunnels table, add after lineId:
branchId: integer("branch_id").references(() => lineBranches.id, { onDelete: "cascade" }),
```

- [ ] **Step 4: Add new fields to `filters` table**

```typescript
// Add to filters table after remark:
domainRules: text("domain_rules"),
sourceUrl: text("source_url"),
sourceUpdatedAt: text("source_updated_at"),
```

- [ ] **Step 5: Replace `lineFilters` with `branchFilters`**

Remove the `lineFilters` table definition and replace with:

```typescript
// ===== branch_filters =====
export const branchFilters = sqliteTable("branch_filters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => lineBranches.id, { onDelete: "cascade" }),
  filterId: integer("filter_id").notNull().references(() => filters.id, { onDelete: "cascade" }),
});
```

- [ ] **Step 6: Update schema exports in `src/lib/db/index.ts`**

Update the import in `src/lib/db/index.ts` to include the new `lineBranches` and `branchFilters` tables (and remove `lineFilters` if it's imported there).

- [ ] **Step 7: Generate and review migration**

```bash
cd /home/coder/workspaces/wiremesh && npx drizzle-kit generate
```

Review the generated SQL in `drizzle/` to verify it creates the new tables and alters existing ones correctly.

- [ ] **Step 8: Write data migration script for existing lines**

Create `drizzle/migrate-branches.sql` — a one-time migration that converts existing single-chain lines to the branch model:

```sql
-- For each existing line, create a default branch
INSERT INTO line_branches (line_id, name, is_default, created_at, updated_at)
SELECT id, '默认出口', 1, datetime('now'), datetime('now') FROM lines;

-- Set branch_id on line_nodes (relay/exit) to point to the new default branch
UPDATE line_nodes SET branch_id = (
  SELECT lb.id FROM line_branches lb WHERE lb.line_id = line_nodes.line_id LIMIT 1
) WHERE role != 'entry';

-- Set branch_id on line_tunnels to point to the new default branch
UPDATE line_tunnels SET branch_id = (
  SELECT lb.id FROM line_branches lb WHERE lb.line_id = line_tunnels.line_id LIMIT 1
);

-- Migrate line_filters to branch_filters
INSERT INTO branch_filters (branch_id, filter_id)
SELECT lb.id, lf.filter_id
FROM line_filters lf
JOIN line_branches lb ON lb.line_id = lf.line_id;

-- Drop old line_filters table
DROP TABLE IF EXISTS line_filters;
```

- [ ] **Step 9: Test migration locally**

```bash
cd /home/coder/workspaces/wiremesh && npm run dev
```

Verify the app starts without errors and existing data (if any) is accessible.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts drizzle/
git commit -m "feat: add line_branches and branch_filters schema for multi-branch routing"
```

---

## Task 2: Lines API — Branch-Aware Creation

**Files:**
- Modify: `src/app/api/lines/route.ts`

- [ ] **Step 1: Update POST handler to accept branches**

Replace the `nodeIds` flat array with a `branches` array structure. The new request body format:

```json
{
  "name": "线路名称",
  "entryNodeId": 1,
  "branches": [
    {
      "name": "日本出口",
      "isDefault": true,
      "nodeIds": [3],
      "filterIds": [1, 2]
    },
    {
      "name": "美国出口",
      "isDefault": false,
      "nodeIds": [5, 7],
      "filterIds": [3]
    }
  ],
  "tags": "tag1,tag2",
  "remark": "备注"
}
```

Each branch's `nodeIds` is the chain after the entry: `[relay1, relay2, ..., exit]`. At minimum one node (the exit).

Rewrite the POST handler in `src/app/api/lines/route.ts`:

```typescript
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, entryNodeId, branches, tags, remark } = body;

  // Validation
  if (!name || !name.trim()) {
    return error("VALIDATION_ERROR", "name 为必填项");
  }
  if (!entryNodeId) {
    return error("VALIDATION_ERROR", "entryNodeId 为必填项");
  }
  if (!branches || !Array.isArray(branches) || branches.length === 0) {
    return error("VALIDATION_ERROR", "至少需要一条分支");
  }

  // Verify exactly one default branch
  const defaultCount = branches.filter((b: { isDefault: boolean }) => b.isDefault).length;
  if (defaultCount !== 1) {
    return error("VALIDATION_ERROR", "必须有且仅有一条默认分支");
  }

  // Verify entry node exists
  const entryNode = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, entryNodeId)).get();
  if (!entryNode) {
    return error("VALIDATION_ERROR", `入口节点 ID ${entryNodeId} 不存在`);
  }

  // Verify all branch node IDs exist
  for (const branch of branches) {
    if (!branch.nodeIds || !Array.isArray(branch.nodeIds) || branch.nodeIds.length === 0) {
      return error("VALIDATION_ERROR", `分支 "${branch.name}" 至少需要一个出口节点`);
    }
    for (const nodeId of branch.nodeIds) {
      const node = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nodeId)).get();
      if (!node) {
        return error("VALIDATION_ERROR", `节点 ID ${nodeId} 不存在`);
      }
    }
  }

  // Read settings for tunnel allocation
  const settingsRows = db.select().from(settings).all();
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) {
    settingsMap[row.key] = row.value;
  }
  const tunnelSubnet = settingsMap["tunnel_subnet"] ?? "10.211.0.0/16";
  const tunnelPortStart = parseInt(settingsMap["tunnel_port_start"] ?? "41830");

  // Read existing tunnels for allocation conflict avoidance
  const existingTunnels = db.select().from(lineTunnels).all();
  const usedAddresses: string[] = existingTunnels.flatMap((t) => [t.fromWgAddress, t.toWgAddress]);
  const usedPorts: number[] = existingTunnels.flatMap((t) => [t.fromWgPort, t.toWgPort]);

  // Insert line
  const line = db.insert(lines).values({
    name: name.trim(),
    status: "active",
    tags: tags ?? null,
    remark: remark ?? null,
  }).returning().get();

  // Insert entry node (line-level, no branch)
  db.insert(lineNodes).values({
    lineId: line.id,
    nodeId: entryNodeId,
    hopOrder: 0,
    role: "entry",
    branchId: null,
  }).run();

  const allAffectedNodeIds = new Set<number>([entryNodeId]);

  // Insert branches
  for (const branchInput of branches) {
    const branch = db.insert(lineBranches).values({
      lineId: line.id,
      name: branchInput.name,
      isDefault: branchInput.isDefault,
    }).returning().get();

    // Insert branch nodes (relay + exit)
    const branchNodeIds = branchInput.nodeIds as number[];
    for (let i = 0; i < branchNodeIds.length; i++) {
      const role = i === branchNodeIds.length - 1 ? "exit" : "relay";
      db.insert(lineNodes).values({
        lineId: line.id,
        branchId: branch.id,
        nodeId: branchNodeIds[i],
        hopOrder: i + 1, // entry is 0
        role,
      }).run();
      allAffectedNodeIds.add(branchNodeIds[i]);
    }

    // Create tunnels: entry → first branch node, then chain within branch
    const fullChain = [entryNodeId, ...branchNodeIds];
    for (let i = 0; i < fullChain.length - 1; i++) {
      const fromNodeId = fullChain[i];
      const toNodeId = fullChain[i + 1];

      const { fromAddress, toAddress } = allocateTunnelSubnet(usedAddresses, tunnelSubnet);
      const fromPort = allocateTunnelPort(usedPorts, tunnelPortStart);
      usedPorts.push(fromPort);
      const toPort = allocateTunnelPort(usedPorts, tunnelPortStart);
      usedPorts.push(toPort);
      usedAddresses.push(fromAddress, toAddress);

      const fromKeyPair = generateKeyPair();
      const toKeyPair = generateKeyPair();

      db.insert(lineTunnels).values({
        lineId: line.id,
        branchId: branch.id,
        hopIndex: i,
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
      }).run();
    }

    // Insert branch_filters
    if (branchInput.filterIds && Array.isArray(branchInput.filterIds)) {
      for (const filterId of branchInput.filterIds) {
        db.insert(branchFilters).values({
          branchId: branch.id,
          filterId,
        }).run();
      }
    }
  }

  writeAuditLog({
    action: "create",
    targetType: "line",
    targetId: line.id,
    targetName: name.trim(),
    detail: `entry=${entryNodeId}, branches=${branches.length}`,
  });

  for (const nodeId of allAffectedNodeIds) {
    sseManager.notifyNodeTunnelUpdate(nodeId);
  }

  return created(line);
}
```

- [ ] **Step 2: Update GET handler to include branch info in list**

In the GET handler, after fetching `lineNodeRows`, also fetch branches for each line:

```typescript
const branchRows = db
  .select()
  .from(lineBranches)
  .where(eq(lineBranches.lineId, line.id))
  .all();
return { ...line, nodes: lineNodeRows, branches: branchRows };
```

- [ ] **Step 3: Verify existing imports are updated**

Make sure the imports at the top of the file include:

```typescript
import { lines, lineNodes, lineTunnels, lineBranches, branchFilters, nodes, settings } from "@/lib/db/schema";
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/lines/route.ts
git commit -m "feat: update lines POST API to support multi-branch creation"
```

---

## Task 3: Lines API — Branch-Aware Detail & Update

**Files:**
- Modify: `src/app/api/lines/[id]/route.ts`

- [ ] **Step 1: Update GET handler to return branches with nodes and filters**

After fetching the line, fetch branches and their associated nodes/filters:

```typescript
// Fetch branches
const branchRows = db
  .select()
  .from(lineBranches)
  .where(eq(lineBranches.lineId, lineId))
  .orderBy(lineBranches.id)
  .all();

// For each branch, get its nodes and filters
const branchesWithDetail = branchRows.map((branch) => {
  const branchNodes = db
    .select({
      hopOrder: lineNodes.hopOrder,
      role: lineNodes.role,
      nodeId: lineNodes.nodeId,
      nodeName: nodes.name,
      nodeStatus: nodes.status,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(eq(lineNodes.branchId, branch.id))
    .orderBy(lineNodes.hopOrder)
    .all();

  const branchFilterRows = db
    .select({
      filterId: branchFilters.filterId,
      filterName: filters.name,
    })
    .from(branchFilters)
    .innerJoin(filters, eq(branchFilters.filterId, filters.id))
    .where(eq(branchFilters.branchId, branch.id))
    .all();

  return { ...branch, nodes: branchNodes, filters: branchFilterRows };
});
```

Include `branchesWithDetail` in the response:

```typescript
return success({ ...line, nodes: lineNodeRows, tunnels, branches: branchesWithDetail, deviceCount });
```

- [ ] **Step 2: Add imports for `lineBranches`, `branchFilters`, `filters`**

```typescript
import { lines, lineNodes, lineTunnels, lineBranches, branchFilters, filters, nodes, devices } from "@/lib/db/schema";
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/lines/[id]/route.ts
git commit -m "feat: return branch details in line GET API"
```

---

## Task 4: Filters API — Branch Association & New Fields

**Files:**
- Modify: `src/app/api/filters/route.ts`
- Modify: `src/app/api/filters/[id]/route.ts`
- Modify: `src/app/api/filters/[id]/toggle/route.ts`

- [ ] **Step 1: Update filters POST to accept new fields**

In `src/app/api/filters/route.ts`, update the POST handler:

```typescript
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, rules, domainRules, mode, branchIds, sourceUrl, tags, remark } = body;

  if (!name || !name.trim()) return error("VALIDATION_ERROR", "name 为必填项");
  if (!rules && !domainRules) return error("VALIDATION_ERROR", "IP/CIDR 规则和域名规则至少填写一项");
  if (!mode || !["whitelist", "blacklist"].includes(mode)) {
    return error("VALIDATION_ERROR", "mode 必须是 whitelist 或 blacklist");
  }

  const filter = db
    .insert(filters)
    .values({
      name: name.trim(),
      rules: rules ?? "",
      domainRules: domainRules ?? null,
      mode,
      isEnabled: true,
      sourceUrl: sourceUrl ?? null,
      tags: tags ?? null,
      remark: remark ?? null,
    })
    .returning()
    .get();

  // Insert branch associations
  if (branchIds && Array.isArray(branchIds)) {
    for (const branchId of branchIds) {
      db.insert(branchFilters).values({ branchId, filterId: filter.id }).run();
    }
  }

  writeAuditLog({
    action: "create",
    targetType: "filter",
    targetId: filter.id,
    targetName: name.trim(),
    detail: `mode=${mode}`,
  });

  // Notify affected entry nodes
  notifyFilterChange(filter.id);

  return created(filter);
}
```

- [ ] **Step 2: Add helper function to notify entry nodes on filter change**

Add at the bottom of the file (or in a shared location):

```typescript
function notifyFilterChange(filterId: number) {
  // Find branches associated with this filter
  const branches = db
    .select({ branchId: branchFilters.branchId })
    .from(branchFilters)
    .where(eq(branchFilters.filterId, filterId))
    .all();

  const lineIds = new Set<number>();
  for (const b of branches) {
    const branch = db
      .select({ lineId: lineBranches.lineId })
      .from(lineBranches)
      .where(eq(lineBranches.id, b.branchId))
      .get();
    if (branch) lineIds.add(branch.lineId);
  }

  // Find entry nodes for these lines
  for (const lineId of lineIds) {
    const entryNodes = db
      .select({ nodeId: lineNodes.nodeId })
      .from(lineNodes)
      .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry")))
      .all();
    for (const n of entryNodes) {
      sseManager.notifyNodeConfigUpdate(n.nodeId);
    }
  }
}
```

- [ ] **Step 3: Update filters GET to include rules count and branch count**

In the GET handler, enrich each row:

```typescript
const result = rows.map((row) => {
  const ipCount = row.rules ? row.rules.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length : 0;
  const domainCount = row.domainRules ? row.domainRules.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length : 0;
  const branchCount = db
    .select({ count: count() })
    .from(branchFilters)
    .where(eq(branchFilters.filterId, row.id))
    .get()?.count ?? 0;
  return { ...row, rulesCount: ipCount + domainCount, branchCount };
});
```

- [ ] **Step 4: Update filter detail GET in `[id]/route.ts`**

Return associated branches (grouped by line) instead of lines:

```typescript
// In the GET handler, replace the line association query:
const associatedBranches = db
  .select({
    branchId: branchFilters.branchId,
    branchName: lineBranches.name,
    lineId: lineBranches.lineId,
    lineName: lines.name,
  })
  .from(branchFilters)
  .innerJoin(lineBranches, eq(branchFilters.branchId, lineBranches.id))
  .innerJoin(lines, eq(lineBranches.lineId, lines.id))
  .where(eq(branchFilters.filterId, filterId))
  .all();

return success({ ...filter, branches: associatedBranches });
```

- [ ] **Step 5: Update filter PUT in `[id]/route.ts`**

Accept `domainRules`, `sourceUrl`, `branchIds`:

```typescript
const { name, rules, domainRules, mode, branchIds, sourceUrl, tags, remark } = body;

// Update filter fields
const updateData: Partial<typeof filters.$inferInsert> = {
  updatedAt: new Date().toISOString(),
};
if (name !== undefined) updateData.name = name;
if (rules !== undefined) updateData.rules = rules;
if (domainRules !== undefined) updateData.domainRules = domainRules;
if (mode !== undefined) updateData.mode = mode;
if (sourceUrl !== undefined) updateData.sourceUrl = sourceUrl;
if (tags !== undefined) updateData.tags = tags;
if (remark !== undefined) updateData.remark = remark;

db.update(filters).set(updateData).where(eq(filters.id, filterId)).returning().get();

// Replace branch associations
if (branchIds !== undefined) {
  db.delete(branchFilters).where(eq(branchFilters.filterId, filterId)).run();
  if (Array.isArray(branchIds)) {
    for (const branchId of branchIds) {
      db.insert(branchFilters).values({ branchId, filterId }).run();
    }
  }
}

notifyFilterChange(filterId);
```

- [ ] **Step 6: Update toggle handler to notify entry nodes**

In `src/app/api/filters/[id]/toggle/route.ts`, add `notifyFilterChange(filterId)` after toggling.

- [ ] **Step 7: Update imports across all modified filter API files**

Ensure all filter API files import `lineBranches`, `branchFilters`, `lines` from schema, plus `sseManager` and `count` from drizzle-orm.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/filters/
git commit -m "feat: update filters API for branch association, domain rules, and source URL"
```

---

## Task 5: Filter Sync API Endpoint

**Files:**
- Create: `src/app/api/filters/[id]/sync/route.ts`

- [ ] **Step 1: Create sync endpoint**

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, branchFilters, lineBranches, lineNodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "无效的规则 ID");

  const filter = db.select().from(filters).where(eq(filters.id, filterId)).get();
  if (!filter) return error("NOT_FOUND", "规则不存在");
  if (!filter.sourceUrl) return error("VALIDATION_ERROR", "该规则没有配置外部规则源");

  // Find entry nodes associated with this filter and notify them to sync
  const branches = db
    .select({ branchId: branchFilters.branchId })
    .from(branchFilters)
    .where(eq(branchFilters.filterId, filterId))
    .all();

  const notifiedNodes = new Set<number>();
  for (const b of branches) {
    const branch = db
      .select({ lineId: lineBranches.lineId })
      .from(lineBranches)
      .where(eq(lineBranches.id, b.branchId))
      .get();
    if (!branch) continue;

    const entryNodes = db
      .select({ nodeId: lineNodes.nodeId })
      .from(lineNodes)
      .where(and(eq(lineNodes.lineId, branch.lineId), eq(lineNodes.role, "entry")))
      .all();

    for (const n of entryNodes) {
      if (!notifiedNodes.has(n.nodeId)) {
        sseManager.notifyNodeConfigUpdate(n.nodeId);
        notifiedNodes.add(n.nodeId);
      }
    }
  }

  return success({ message: "同步通知已发送", notifiedNodes: notifiedNodes.size });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/filters/[id]/sync/route.ts
git commit -m "feat: add filter sync API endpoint for external rule source"
```

---

## Task 6: Agent Config API — Routing Section

**Files:**
- Modify: `src/app/api/agent/config/route.ts`

- [ ] **Step 1: Add routing section generation for entry nodes**

After the existing xray config generation, add routing section. Import `lineBranches`, `branchFilters`, `filters` from schema:

```typescript
import { nodes, lineNodes, lineTunnels, lineBranches, branchFilters, filters, devices, settings } from "@/lib/db/schema";
```

Add routing generation code after xray config and before constructing the final response:

```typescript
// ---- Routing config (entry nodes only) ----
let routingConfig: {
  enabled: boolean;
  dns: { listen: string; upstream: string[] };
  branches: {
    id: number;
    name: string;
    is_default: boolean;
    tunnel: string;
    mark: number;
    ip_rules: string[];
    domain_rules: string[];
    rule_sources: { filter_id: number; url: string; sync_interval: number }[];
  }[];
} | null = null;

if (entryLineIds.length > 0) {
  // Read DNS upstream setting
  const dnsUpstreamSetting = db.select().from(settings).where(eq(settings.key, "dns_upstream")).get();
  const dnsUpstream = (dnsUpstreamSetting?.value ?? "8.8.8.8,1.1.1.1").split(",").map(s => s.trim());

  const syncIntervalSetting = db.select().from(settings).where(eq(settings.key, "filter_sync_interval")).get();
  const defaultSyncInterval = parseInt(syncIntervalSetting?.value ?? "86400");

  const routingBranches: typeof routingConfig extends null ? never : NonNullable<typeof routingConfig>["branches"] = [];
  let markCounter = 41001;

  for (const lineId of entryLineIds) {
    const branches = db
      .select()
      .from(lineBranches)
      .where(eq(lineBranches.lineId, lineId))
      .all();

    for (const branch of branches) {
      // Find the tunnel interface name for this branch (entry → first hop)
      const branchTunnel = lineToDownstreamIface.get(lineId);
      // For multi-branch, we need per-branch tunnel lookup
      // The tunnel from entry to this branch's first node
      const branchTunnels = db
        .select()
        .from(lineTunnels)
        .where(and(
          eq(lineTunnels.lineId, lineId),
          eq(lineTunnels.branchId, branch.id),
          eq(lineTunnels.fromNodeId, nodeId)
        ))
        .all();

      if (branchTunnels.length === 0) continue;

      // Find the interface name from the already-built interfaces list
      const firstTunnel = branchTunnels[0];
      const tunnelIface = interfaces.find(
        (iface) => iface.listenPort === firstTunnel.fromWgPort
      );
      if (!tunnelIface) continue;

      // Get associated enabled filters
      const branchFilterRows = db
        .select()
        .from(branchFilters)
        .innerJoin(filters, eq(branchFilters.filterId, filters.id))
        .where(eq(branchFilters.branchId, branch.id))
        .all()
        .filter((row) => row.filters.isEnabled);

      const ipRules: string[] = [];
      const domainRules: string[] = [];
      const ruleSources: { filter_id: number; url: string; sync_interval: number }[] = [];

      for (const row of branchFilterRows) {
        const f = row.filters;
        if (f.rules) {
          const lines = f.rules.split("\n")
            .map(l => l.trim())
            .filter(l => l && !l.startsWith("#"));
          ipRules.push(...lines);
        }
        if (f.domainRules) {
          const lines = f.domainRules.split("\n")
            .map(l => l.trim())
            .filter(l => l && !l.startsWith("#"));
          domainRules.push(...lines);
        }
        if (f.sourceUrl) {
          ruleSources.push({
            filter_id: f.id,
            url: f.sourceUrl,
            sync_interval: defaultSyncInterval,
          });
        }
      }

      routingBranches.push({
        id: branch.id,
        name: branch.name,
        is_default: branch.isDefault,
        tunnel: tunnelIface.name,
        mark: markCounter++,
        ip_rules: branch.isDefault ? [] : ipRules,
        domain_rules: branch.isDefault ? [] : domainRules,
        rule_sources: branch.isDefault ? [] : ruleSources,
      });
    }
  }

  if (routingBranches.length > 0) {
    routingConfig = {
      enabled: true,
      dns: {
        listen: node.wgAddress.split("/")[0] + ":53",
        upstream: dnsUpstream,
      },
      branches: routingBranches,
    };
  }
}
```

- [ ] **Step 2: Add `routing` to the config response**

Update the config object at the end:

```typescript
const config = {
  node: { ... },
  peers,
  tunnels: { ... },
  xray: xrayConfig,
  routing: routingConfig,
  version: node.updatedAt,
};
```

- [ ] **Step 3: Update Xray fwmark to start from 42001**

Change `let markCounter = 201;` to `let markCounter = 42001;` in the Xray routes section.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat: add routing section to agent config API with branch-based rules"
```

---

## Task 7: Settings Page — New Filter Settings

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Add filter_sync_interval and dns_upstream settings**

Read the existing settings page to understand the pattern, then add two new fields in the settings form:

- `filter_sync_interval`: number input, label "外部规则源同步间隔（秒）", default 86400
- `dns_upstream`: text input, label "DNS 上游服务器（逗号分隔）", default "8.8.8.8,1.1.1.1"

Follow the same pattern as other settings fields in the page.

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/settings/page.tsx
git commit -m "feat: add filter sync interval and DNS upstream settings"
```

---

## Task 8: Filters UI — Domain Rules, Source URL, Branch Association

**Files:**
- Modify: `src/app/(dashboard)/filters/new/page.tsx`
- Modify: `src/app/(dashboard)/filters/[id]/page.tsx`
- Modify: `src/app/(dashboard)/filters/page.tsx`

- [ ] **Step 1: Update filter creation page**

In `src/app/(dashboard)/filters/new/page.tsx`:

1. Add `domainRules` state (`useState("")`)
2. Add `sourceUrl` state (`useState("")`)
3. Replace the "关联线路" checkbox section with "关联分支" — fetch `/api/lines?pageSize=100` and for each line, show its branches as checkboxes (grouped by line name)
4. Replace `selectedLineIds` with `selectedBranchIds`
5. Add a "域名规则" textarea after the IP/CIDR textarea:

```tsx
<div className="space-y-2">
  <Label htmlFor="domainRules">域名规则</Label>
  <Textarea
    id="domainRules"
    value={domainRules}
    onChange={(e) => setDomainRules(e.target.value)}
    rows={6}
    placeholder={"每行一条域名，例如：\ngoogle.com\nyoutube.com\n*.netflix.com"}
    className="font-mono text-sm"
  />
  <p className="text-xs text-muted-foreground">匹配域名及其所有子域名</p>
</div>
```

6. Add external source URL input:

```tsx
<div className="space-y-2">
  <Label htmlFor="sourceUrl">外部规则源（可选）</Label>
  <Input
    id="sourceUrl"
    value={sourceUrl}
    onChange={(e) => setSourceUrl(e.target.value)}
    placeholder="https://example.com/ip-list.txt"
  />
  <p className="text-xs text-muted-foreground">定期从该 URL 拉取规则，自动分类 IP 和域名</p>
</div>
```

7. Update `handleSubmit` to send `domainRules`, `sourceUrl`, `branchIds` instead of `lineIds`
8. Change validation: `rules` and `domainRules` at least one must be non-empty (unless sourceUrl is set)

- [ ] **Step 2: Fetch branches for association**

Replace the lines fetch with a call that returns branches:

```typescript
type LineWithBranches = {
  id: number;
  name: string;
  branches: { id: number; name: string; isDefault: boolean }[];
};

const [linesWithBranches, setLinesWithBranches] = useState<LineWithBranches[]>([]);

useEffect(() => {
  fetch("/api/lines?pageSize=100")
    .then((res) => res.json())
    .then((json) => {
      // Each line in the list should now include branches
      setLinesWithBranches(json.data ?? []);
    })
    .catch(() => {});
}, []);
```

Render as grouped checkboxes:

```tsx
<div className="space-y-2">
  <Label>关联分支</Label>
  {linesWithBranches.length === 0 ? (
    <p className="text-sm text-muted-foreground">暂无线路</p>
  ) : (
    <div className="space-y-3 border rounded-md p-3">
      {linesWithBranches.map((line) => (
        <div key={line.id}>
          <p className="text-sm font-medium mb-1">{line.name}</p>
          <div className="ml-4 space-y-1">
            {line.branches?.map((branch) => (
              <div key={branch.id} className="flex items-center gap-2">
                <Checkbox
                  id={`branch-${branch.id}`}
                  checked={selectedBranchIds.includes(branch.id)}
                  onCheckedChange={() => toggleBranch(branch.id)}
                />
                <label htmlFor={`branch-${branch.id}`} className="text-sm cursor-pointer">
                  {branch.name}{branch.isDefault ? "（默认）" : ""}
                </label>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 3: Update filter edit page similarly**

Apply the same changes to `src/app/(dashboard)/filters/[id]/page.tsx`:
- Add `domainRules`, `sourceUrl` fields
- Replace line association with branch association
- Load existing values from the filter detail API
- Add a "立即同步" button that calls `POST /api/filters/${filterId}/sync` when `sourceUrl` is set

```tsx
{filter.sourceUrl && (
  <div className="flex items-center gap-2">
    <p className="text-xs text-muted-foreground">
      上次同步：{filter.sourceUpdatedAt ?? "从未同步"}
    </p>
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        const res = await fetch(`/api/filters/${filterId}/sync`, { method: "POST" });
        if (res.ok) toast.success("同步通知已发送");
        else toast.error("同步失败");
      }}
    >
      立即同步
    </Button>
  </div>
)}
```

- [ ] **Step 4: Update filter list page**

In `src/app/(dashboard)/filters/page.tsx`, add `rulesCount` and `branchCount` columns:

```typescript
type Filter = {
  id: number;
  name: string;
  mode: string;
  isEnabled: boolean;
  rulesCount: number;
  branchCount: number;
  tags: string | null;
  remark: string | null;
};
```

Add columns:

```typescript
{
  key: "rulesCount",
  label: "规则数",
  render: (row) => <span>{row.rulesCount} 条</span>,
},
{
  key: "branchCount",
  label: "关联分支",
  render: (row) => <span>{row.branchCount} 个</span>,
},
```

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/filters/
git commit -m "feat: update filters UI with domain rules, source URL, and branch association"
```

---

## Task 9: Lines UI — Multi-Branch Creation

**Files:**
- Modify: `src/app/(dashboard)/lines/new/page.tsx`

- [ ] **Step 1: Redesign state model**

Replace the flat `nodeIds` array with structured state:

```typescript
type BranchInput = {
  name: string;
  isDefault: boolean;
  nodeIds: string[]; // [relay1, relay2, ..., exit] — exit is last
  filterIds: number[];
};

const [entryNodeId, setEntryNodeId] = useState("");
const [branches, setBranches] = useState<BranchInput[]>([
  { name: "默认出口", isDefault: true, nodeIds: [""], filterIds: [] },
]);
const [availableFilters, setAvailableFilters] = useState<{ id: number; name: string }[]>([]);
```

- [ ] **Step 2: Fetch filters for branch association**

```typescript
useEffect(() => {
  Promise.all([
    fetch("/api/nodes?pageSize=100").then((r) => r.json()),
    fetch("/api/filters?pageSize=100").then((r) => r.json()),
  ]).then(([nodesJson, filtersJson]) => {
    setNodeOptions(nodesJson.data ?? []);
    setAvailableFilters(filtersJson.data ?? []);
    setLoadingNodes(false);
  }).catch(() => {
    toast.error("加载数据失败");
    setLoadingNodes(false);
  });
}, []);
```

- [ ] **Step 3: Implement branch management UI**

Each branch is a Card with:
- Branch name input
- Default branch radio
- Node chain (relay nodes + exit node) with add/remove relay
- Filter multi-select checkboxes
- Delete branch button (disabled if only one branch)

```tsx
{branches.map((branch, branchIdx) => (
  <Card key={branchIdx}>
    <CardHeader>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Input
            value={branch.name}
            onChange={(e) => updateBranch(branchIdx, { name: e.target.value })}
            placeholder="分支名称"
            className="w-48"
          />
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="defaultBranch"
              checked={branch.isDefault}
              onChange={() => setDefaultBranch(branchIdx)}
            />
            默认分支
          </label>
        </div>
        {branches.length > 1 && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => removeBranch(branchIdx)}
          >
            删除分支
          </Button>
        )}
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {/* Node chain for this branch */}
      {branch.nodeIds.map((nodeId, nodeIdx) => (
        <div key={nodeIdx} className="flex items-center gap-2">
          <div className="flex-1 space-y-1">
            <Label>{nodeIdx === branch.nodeIds.length - 1 ? "出口节点" : "中转节点"}</Label>
            <Select
              value={nodeId}
              onValueChange={(val) => setBranchNodeAt(branchIdx, nodeIdx, val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择节点" />
              </SelectTrigger>
              <SelectContent>
                {nodeOptions.map((n) => (
                  <SelectItem key={n.id} value={String(n.id)}>
                    {n.name} ({n.ip})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {nodeIdx < branch.nodeIds.length - 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-6"
              onClick={() => removeBranchRelay(branchIdx, nodeIdx)}
            >
              移除
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => addBranchRelay(branchIdx)}
      >
        添加中转
      </Button>

      {/* Filter association */}
      {availableFilters.length > 0 && (
        <div className="space-y-2">
          <Label>分流规则</Label>
          <div className="flex flex-wrap gap-2">
            {availableFilters.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox
                  checked={branch.filterIds.includes(f.id)}
                  onCheckedChange={() => toggleBranchFilter(branchIdx, f.id)}
                />
                {f.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </CardContent>
  </Card>
))}

<Button type="button" variant="outline" onClick={addBranch}>
  添加分支
</Button>
```

- [ ] **Step 4: Implement helper functions**

```typescript
const updateBranch = (idx: number, update: Partial<BranchInput>) => {
  setBranches((prev) => prev.map((b, i) => (i === idx ? { ...b, ...update } : b)));
};

const setDefaultBranch = (idx: number) => {
  setBranches((prev) => prev.map((b, i) => ({ ...b, isDefault: i === idx })));
};

const removeBranch = (idx: number) => {
  setBranches((prev) => {
    const next = prev.filter((_, i) => i !== idx);
    if (!next.some((b) => b.isDefault) && next.length > 0) {
      next[0].isDefault = true;
    }
    return next;
  });
};

const addBranch = () => {
  setBranches((prev) => [
    ...prev,
    { name: "", isDefault: false, nodeIds: [""], filterIds: [] },
  ]);
};

const setBranchNodeAt = (branchIdx: number, nodeIdx: number, value: string) => {
  setBranches((prev) =>
    prev.map((b, i) => {
      if (i !== branchIdx) return b;
      const next = [...b.nodeIds];
      next[nodeIdx] = value;
      return { ...b, nodeIds: next };
    })
  );
};

const addBranchRelay = (branchIdx: number) => {
  setBranches((prev) =>
    prev.map((b, i) => {
      if (i !== branchIdx) return b;
      const next = [...b.nodeIds];
      next.splice(next.length - 1, 0, "");
      return { ...b, nodeIds: next };
    })
  );
};

const removeBranchRelay = (branchIdx: number, nodeIdx: number) => {
  setBranches((prev) =>
    prev.map((b, i) => {
      if (i !== branchIdx) return b;
      return { ...b, nodeIds: b.nodeIds.filter((_, j) => j !== nodeIdx) };
    })
  );
};

const toggleBranchFilter = (branchIdx: number, filterId: number) => {
  setBranches((prev) =>
    prev.map((b, i) => {
      if (i !== branchIdx) return b;
      const ids = b.filterIds.includes(filterId)
        ? b.filterIds.filter((id) => id !== filterId)
        : [...b.filterIds, filterId];
      return { ...b, filterIds: ids };
    })
  );
};
```

- [ ] **Step 5: Update handleSubmit**

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!name.trim()) { toast.error("线路名称不能为空"); return; }
  if (!entryNodeId) { toast.error("请选择入口节点"); return; }
  if (branches.some((b) => !b.name.trim())) { toast.error("分支名称不能为空"); return; }
  if (branches.some((b) => b.nodeIds.some((id) => !id))) { toast.error("请为每个位置选择节点"); return; }

  setSubmitting(true);
  try {
    const res = await fetch("/api/lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        entryNodeId: Number(entryNodeId),
        branches: branches.map((b) => ({
          name: b.name.trim(),
          isDefault: b.isDefault,
          nodeIds: b.nodeIds.map(Number),
          filterIds: b.filterIds,
        })),
        tags: tags.trim() || null,
        remark: remark.trim() || null,
      }),
    });
    const json = await res.json();
    if (res.ok) {
      toast.success("线路创建成功");
      router.push("/lines");
    } else {
      toast.error(json.error?.message ?? "创建失败");
    }
  } catch {
    toast.error("创建失败，请重试");
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/lines/new/page.tsx
git commit -m "feat: redesign line creation page with multi-branch support"
```

---

## Task 10: Lines UI — Detail Page with Branches

**Files:**
- Modify: `src/app/(dashboard)/lines/[id]/page.tsx`

- [ ] **Step 1: Read the current line detail page**

Read `src/app/(dashboard)/lines/[id]/page.tsx` to understand its current layout and data structure.

- [ ] **Step 2: Update to display branch topology**

Display each branch as a card showing:
- Branch name and default badge
- Node chain: entry → relay(s) → exit
- Associated filters as badges
- Chain preview (node names joined by →)

The entry node is shown above all branch cards (shared across branches).

Follow the same UI patterns used in the creation page (Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/lines/[id]/page.tsx
git commit -m "feat: update line detail page to show branch topology"
```

---

## Task 11: Agent — Routing Types & Config Parsing

**Files:**
- Modify: `agent/api/config_types.go`

- [ ] **Step 1: Add routing types to config_types.go**

```go
// RoutingConfig contains the routing rules for entry nodes
type RoutingConfig struct {
	Enabled  bool            `json:"enabled"`
	DNS      DNSConfig       `json:"dns"`
	Branches []RoutingBranch `json:"branches"`
}

type DNSConfig struct {
	Listen   string   `json:"listen"`
	Upstream []string `json:"upstream"`
}

type RoutingBranch struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	IsDefault   bool         `json:"is_default"`
	Tunnel      string       `json:"tunnel"`
	Mark        int          `json:"mark"`
	IPRules     []string     `json:"ip_rules"`
	DomainRules []string     `json:"domain_rules"`
	RuleSources []RuleSource `json:"rule_sources"`
}

type RuleSource struct {
	FilterID     int    `json:"filter_id"`
	URL          string `json:"url"`
	SyncInterval int    `json:"sync_interval"` // seconds
}
```

- [ ] **Step 2: Add Routing field to ConfigData**

```go
type ConfigData struct {
	Node    NodeConfig     `json:"node"`
	Peers   []PeerConfig   `json:"peers"`
	Tunnels TunnelConfig   `json:"tunnels"`
	Xray    *XrayConfig    `json:"xray"`
	Routing *RoutingConfig `json:"routing"`
	Version string         `json:"version"`
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/coder/workspaces/wiremesh && git add agent/api/config_types.go
git commit -m "feat: add routing config types for branch-based routing"
```

---

## Task 12: Agent — ipset Wrapper

**Files:**
- Create: `agent/ipset/ipset.go`

- [ ] **Step 1: Create ipset package**

```go
package ipset

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// Create creates a hash:ip ipset with the given name.
// If it already exists, it is flushed.
func Create(name string) error {
	// Try create; if exists, flush instead
	out, err := exec.Command("ipset", "create", name, "hash:ip", "timeout", "0").CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "already exists") {
			return Flush(name)
		}
		return fmt.Errorf("ipset create %s: %w: %s", name, err, string(out))
	}
	log.Printf("[ipset] Created set: %s", name)
	return nil
}

// Flush removes all entries from the named ipset.
func Flush(name string) error {
	out, err := exec.Command("ipset", "flush", name).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ipset flush %s: %w: %s", name, err, string(out))
	}
	return nil
}

// Add adds an IP to the ipset with the given timeout (seconds).
// timeout=0 means no expiry.
func Add(name, ip string, timeout int) error {
	args := []string{"add", name, ip}
	if timeout > 0 {
		args = append(args, "timeout", fmt.Sprintf("%d", timeout))
	}
	out, err := exec.Command("ipset", args...).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "already added") {
			return nil
		}
		return fmt.Errorf("ipset add %s %s: %w: %s", name, ip, err, string(out))
	}
	return nil
}

// Destroy removes the named ipset entirely.
func Destroy(name string) error {
	out, err := exec.Command("ipset", "destroy", name).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "does not exist") {
			return nil
		}
		return fmt.Errorf("ipset destroy %s: %w: %s", name, err, string(out))
	}
	log.Printf("[ipset] Destroyed set: %s", name)
	return nil
}

// DestroyAllWireMesh destroys all ipsets with "wm-" prefix.
func DestroyAllWireMesh() {
	out, err := exec.Command("ipset", "list", "-name").CombinedOutput()
	if err != nil {
		return
	}
	for _, name := range strings.Split(string(out), "\n") {
		name = strings.TrimSpace(name)
		if strings.HasPrefix(name, "wm-") {
			Destroy(name)
		}
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/ipset/
git commit -m "feat: add ipset wrapper package for DNS-based routing"
```

---

## Task 13: Agent — DNS Proxy

**Files:**
- Create: `agent/dns/proxy.go`
- Create: `agent/dns/rules.go`
- Modify: `agent/go.mod`

- [ ] **Step 1: Add miekg/dns dependency**

```bash
cd /home/coder/workspaces/wiremesh/agent && go get github.com/miekg/dns
```

- [ ] **Step 2: Create domain rule matching logic**

Create `agent/dns/rules.go`:

```go
package dns

import (
	"strings"
	"sync"
)

// DomainMatcher stores domain rules mapped to branch ipset names.
type DomainMatcher struct {
	mu    sync.RWMutex
	rules map[string]string // domain -> ipset name (e.g. "google.com" -> "wm-branch-2")
}

func NewDomainMatcher() *DomainMatcher {
	return &DomainMatcher{rules: make(map[string]string)}
}

// SetRules replaces all rules. Each domain maps to a branch ipset name.
func (m *DomainMatcher) SetRules(rules map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rules = make(map[string]string, len(rules))
	for domain, ipsetName := range rules {
		// Normalize: remove leading "*." and ensure lowercase
		d := strings.ToLower(strings.TrimPrefix(domain, "*."))
		m.rules[d] = ipsetName
	}
}

// Match checks if a query domain matches any rule.
// Returns the ipset name and true if matched, empty string and false otherwise.
func (m *DomainMatcher) Match(queryDomain string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Normalize: lowercase, remove trailing dot
	qd := strings.ToLower(strings.TrimSuffix(queryDomain, "."))

	// Check exact match and suffix match (walk up the domain)
	parts := strings.Split(qd, ".")
	for i := 0; i < len(parts); i++ {
		candidate := strings.Join(parts[i:], ".")
		if ipsetName, ok := m.rules[candidate]; ok {
			return ipsetName, true
		}
	}
	return "", false
}
```

- [ ] **Step 3: Create DNS proxy**

Create `agent/dns/proxy.go`:

```go
package dns

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	mdns "github.com/miekg/dns"
	"github.com/wiremesh/agent/ipset"
)

// Proxy is a forwarding DNS proxy that intercepts matching domains
// and adds resolved IPs to ipsets for policy routing.
type Proxy struct {
	listenAddr string
	upstream   []string
	matcher    *DomainMatcher
	server     *mdns.Server
	client     *mdns.Client
	mu         sync.Mutex
	running    bool
}

func NewProxy(listenAddr string, upstream []string) *Proxy {
	return &Proxy{
		listenAddr: listenAddr,
		upstream:   upstream,
		matcher:    NewDomainMatcher(),
		client:     &mdns.Client{Timeout: 5 * time.Second},
	}
}

// UpdateRules replaces the domain matching rules.
func (p *Proxy) UpdateRules(rules map[string]string) {
	p.matcher.SetRules(rules)
	log.Printf("[dns] Updated domain rules: %d entries", len(rules))
}

// Start begins listening for DNS queries.
func (p *Proxy) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return nil
	}

	mux := mdns.NewServeMux()
	mux.HandleFunc(".", p.handleQuery)

	p.server = &mdns.Server{
		Addr:    p.listenAddr,
		Net:     "udp",
		Handler: mux,
	}

	go func() {
		log.Printf("[dns] Starting DNS proxy on %s", p.listenAddr)
		if err := p.server.ListenAndServe(); err != nil {
			log.Printf("[dns] DNS proxy error: %v", err)
		}
	}()

	p.running = true
	return nil
}

// Stop shuts down the DNS proxy.
func (p *Proxy) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return
	}
	if p.server != nil {
		p.server.Shutdown()
	}
	p.running = false
	log.Println("[dns] DNS proxy stopped")
}

func (p *Proxy) handleQuery(w mdns.ResponseWriter, r *mdns.Msg) {
	// Forward to upstream
	resp, err := p.forward(r)
	if err != nil {
		log.Printf("[dns] Forward error: %v", err)
		msg := new(mdns.Msg)
		msg.SetRcode(r, mdns.RcodeServerFailure)
		w.WriteMsg(msg)
		return
	}

	// Check if any question matches our domain rules
	for _, q := range r.Question {
		if q.Qtype != mdns.TypeA && q.Qtype != mdns.TypeAAAA {
			continue
		}
		ipsetName, matched := p.matcher.Match(q.Name)
		if !matched {
			continue
		}

		// Extract IPs from answer and add to ipset
		for _, ans := range resp.Answer {
			var ip string
			var ttl uint32
			switch rr := ans.(type) {
			case *mdns.A:
				ip = rr.A.String()
				ttl = rr.Hdr.Ttl
			case *mdns.AAAA:
				ip = rr.AAAA.String()
				ttl = rr.Hdr.Ttl
			default:
				continue
			}

			if ttl < 60 {
				ttl = 60 // minimum 60s to avoid excessive churn
			}

			if err := ipset.Add(ipsetName, ip, int(ttl)); err != nil {
				log.Printf("[dns] Failed to add %s to ipset %s: %v", ip, ipsetName, err)
			}
		}
	}

	w.WriteMsg(resp)
}

func (p *Proxy) forward(r *mdns.Msg) (*mdns.Msg, error) {
	for _, upstream := range p.upstream {
		addr := upstream
		if _, _, err := net.SplitHostPort(addr); err != nil {
			addr = addr + ":53"
		}
		resp, _, err := p.client.Exchange(r, addr)
		if err == nil {
			return resp, nil
		}
	}
	return nil, fmt.Errorf("all upstream DNS servers failed")
}
```

- [ ] **Step 4: Commit**

```bash
git add agent/dns/ agent/go.mod agent/go.sum
git commit -m "feat: add embedded DNS proxy with domain matching and ipset integration"
```

---

## Task 14: Agent — Routing Manager

**Files:**
- Create: `agent/routing/manager.go`
- Create: `agent/routing/sync.go`

- [ ] **Step 1: Create routing manager**

Create `agent/routing/manager.go`:

```go
package routing

import (
	"fmt"
	"log"
	"os/exec"
	"strings"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/dns"
	"github.com/wiremesh/agent/ipset"
)

// Manager orchestrates branch-based routing: ip rules, iptables mangle, ipset, DNS proxy.
type Manager struct {
	dnsProxy   *dns.Proxy
	syncer     *SourceSyncer
	lastConfig *api.RoutingConfig
}

func NewManager() *Manager {
	return &Manager{}
}

// Sync applies the routing configuration from the management platform.
func (m *Manager) Sync(cfg *api.RoutingConfig) error {
	if cfg == nil || !cfg.Enabled || len(cfg.Branches) == 0 {
		m.Cleanup()
		return nil
	}

	// 1. Clean old routing rules
	m.cleanIPRules()
	m.cleanMangleRules()

	// 2. Set up each branch
	domainRules := make(map[string]string) // domain -> ipset name

	for _, branch := range cfg.Branches {
		table := fmt.Sprintf("%d", branch.Mark)
		markHex := fmt.Sprintf("0x%x", branch.Mark)
		ipsetName := fmt.Sprintf("wm-branch-%d", branch.ID)

		// Create routing table and ip rule
		run("ip", "route", "replace", "default", "dev", branch.Tunnel, "table", table)

		if branch.IsDefault {
			// Default branch: lowest priority, match unmarked traffic
			run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", "32000")
			// Mark all unmarked traffic from wm-wg0
			addMangleRule(fmt.Sprintf(
				"-A PREROUTING -i wm-wg0 -m mark --mark 0 -j MARK --set-mark %s -m comment --comment wm-branch-default",
				markHex,
			))
		} else {
			// Non-default branch: higher priority
			run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", table)

			// IP/CIDR rules: iptables mangle PREROUTING
			for _, cidr := range branch.IPRules {
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 -d %s -j MARK --set-mark %s -m comment --comment wm-branch-%d",
					cidr, markHex, branch.ID,
				))
			}

			// Domain rules: create ipset + iptables match
			if len(branch.DomainRules) > 0 {
				ipset.Create(ipsetName)
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 -m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-branch-%d-dns",
					ipsetName, markHex, branch.ID,
				))
				for _, domain := range branch.DomainRules {
					domainRules[domain] = ipsetName
				}
			}
		}
	}

	// 3. Start/update DNS proxy
	if len(domainRules) > 0 {
		if m.dnsProxy == nil {
			m.dnsProxy = dns.NewProxy(cfg.DNS.Listen, cfg.DNS.Upstream)
			m.dnsProxy.Start()
		}
		m.dnsProxy.UpdateRules(domainRules)
	} else if m.dnsProxy != nil {
		m.dnsProxy.Stop()
		m.dnsProxy = nil
	}

	// 4. Start/update external rule source syncer
	if m.syncer == nil {
		m.syncer = NewSourceSyncer(m)
	}
	m.syncer.UpdateSources(cfg.Branches)

	m.lastConfig = cfg
	log.Printf("[routing] Routing configured: %d branches", len(cfg.Branches))
	return nil
}

// Cleanup removes all routing rules and stops DNS proxy.
func (m *Manager) Cleanup() {
	m.cleanIPRules()
	m.cleanMangleRules()
	ipset.DestroyAllWireMesh()
	if m.dnsProxy != nil {
		m.dnsProxy.Stop()
		m.dnsProxy = nil
	}
	if m.syncer != nil {
		m.syncer.Stop()
		m.syncer = nil
	}
	log.Println("[routing] Routing cleaned up")
}

func (m *Manager) cleanIPRules() {
	// Clean branch routing tables (41001-41999)
	for i := 41001; i <= 41999; i++ {
		table := fmt.Sprintf("%d", i)
		markHex := fmt.Sprintf("0x%x", i)
		_, err := exec.Command("ip", "rule", "del", "fwmark", markHex).CombinedOutput()
		if err != nil {
			break
		}
		exec.Command("ip", "route", "flush", "table", table).CombinedOutput()
	}
	// Clean default branch rule
	exec.Command("ip", "rule", "del", "priority", "32000").CombinedOutput()
}

func (m *Manager) cleanMangleRules() {
	// List and remove all wm-branch-* mangle rules
	out, err := exec.Command("iptables", "-t", "mangle", "-S", "PREROUTING").CombinedOutput()
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "wm-branch") && strings.HasPrefix(line, "-A ") {
			deleteRule := strings.Replace(line, "-A ", "-D ", 1)
			args := strings.Fields("-t mangle " + deleteRule)
			exec.Command("iptables", args...).CombinedOutput()
		}
	}
}

// ReapplyIPRules re-applies IP rules for a branch after external source sync.
func (m *Manager) ReapplyIPRules(branchID int, ipRules []string) {
	if m.lastConfig == nil {
		return
	}
	for _, branch := range m.lastConfig.Branches {
		if branch.ID == branchID && !branch.IsDefault {
			markHex := fmt.Sprintf("0x%x", branch.Mark)
			// Remove old rules for this branch
			removeMangleRulesByComment(fmt.Sprintf("wm-branch-%d", branchID))
			// Re-add with new IP list
			for _, cidr := range ipRules {
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 -d %s -j MARK --set-mark %s -m comment --comment wm-branch-%d",
					cidr, markHex, branchID,
				))
			}
			break
		}
	}
}

func addMangleRule(rule string) {
	args := strings.Fields("-t mangle " + rule)
	out, err := exec.Command("iptables", args...).CombinedOutput()
	if err != nil {
		log.Printf("[routing] Error adding mangle rule: %s: %v: %s", rule, err, string(out))
	}
}

func removeMangleRulesByComment(comment string) {
	out, err := exec.Command("iptables", "-t", "mangle", "-S", "PREROUTING").CombinedOutput()
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, comment) && strings.HasPrefix(line, "-A ") {
			deleteRule := strings.Replace(line, "-A ", "-D ", 1)
			args := strings.Fields("-t mangle " + deleteRule)
			exec.Command("iptables", args...).CombinedOutput()
		}
	}
}

func run(args ...string) {
	out, err := exec.Command(args[0], args[1:]...).CombinedOutput()
	if err != nil && !strings.Contains(string(out), "File exists") {
		log.Printf("[routing] %s: %v: %s", strings.Join(args, " "), err, string(out))
	}
}
```

- [ ] **Step 2: Create external rule source syncer**

Create `agent/routing/sync.go`:

```go
package routing

import (
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/ipset"
)

// SourceSyncer periodically fetches external rule sources and updates routing.
type SourceSyncer struct {
	manager  *Manager
	timers   map[int]*time.Timer // filter_id -> timer
	mu       sync.Mutex
	client   *http.Client
	stopCh   chan struct{}
}

func NewSourceSyncer(manager *Manager) *SourceSyncer {
	return &SourceSyncer{
		manager: manager,
		timers:  make(map[int]*time.Timer),
		client:  &http.Client{Timeout: 30 * time.Second},
		stopCh:  make(chan struct{}),
	}
}

// UpdateSources sets up timers for all external rule sources.
func (s *SourceSyncer) UpdateSources(branches []api.RoutingBranch) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop existing timers
	for _, timer := range s.timers {
		timer.Stop()
	}
	s.timers = make(map[int]*time.Timer)

	// Start new timers
	for _, branch := range branches {
		for _, src := range branch.RuleSources {
			branchID := branch.ID
			source := src
			// Run immediately, then on interval
			go s.fetchAndApply(branchID, source)
			interval := time.Duration(source.SyncInterval) * time.Second
			timer := time.AfterFunc(interval, func() {
				s.periodicSync(branchID, source, interval)
			})
			s.timers[source.FilterID] = timer
		}
	}
}

func (s *SourceSyncer) periodicSync(branchID int, source api.RuleSource, interval time.Duration) {
	select {
	case <-s.stopCh:
		return
	default:
	}
	s.fetchAndApply(branchID, source)
	s.mu.Lock()
	s.timers[source.FilterID] = time.AfterFunc(interval, func() {
		s.periodicSync(branchID, source, interval)
	})
	s.mu.Unlock()
}

func (s *SourceSyncer) fetchAndApply(branchID int, source api.RuleSource) {
	log.Printf("[sync] Fetching rule source filter=%d url=%s", source.FilterID, source.URL)

	resp, err := s.client.Get(source.URL)
	if err != nil {
		log.Printf("[sync] Fetch failed for filter=%d: %v", source.FilterID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Printf("[sync] Fetch failed for filter=%d: status %d", source.FilterID, resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[sync] Read failed for filter=%d: %v", source.FilterID, err)
		return
	}

	// Parse lines: classify as IP/CIDR or domain
	var ipRules []string
	var domainRules []string

	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if isIPOrCIDR(line) {
			ipRules = append(ipRules, line)
		} else {
			domainRules = append(domainRules, line)
		}
	}

	log.Printf("[sync] Filter=%d parsed: %d IPs, %d domains", source.FilterID, len(ipRules), len(domainRules))

	// Apply IP rules
	if len(ipRules) > 0 {
		s.manager.ReapplyIPRules(branchID, ipRules)
	}

	// Apply domain rules to DNS proxy
	if len(domainRules) > 0 && s.manager.dnsProxy != nil {
		ipsetName := fmt.Sprintf("wm-branch-%d", branchID)
		newRules := make(map[string]string, len(domainRules))
		for _, d := range domainRules {
			newRules[d] = ipsetName
		}
		// Merge with existing rules (additive)
		s.manager.dnsProxy.UpdateRules(newRules)
	}
}

func isIPOrCIDR(s string) bool {
	if net.ParseIP(s) != nil {
		return true
	}
	_, _, err := net.ParseCIDR(s)
	return err == nil
}

// Stop stops all sync timers.
func (s *SourceSyncer) Stop() {
	close(s.stopCh)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, timer := range s.timers {
		timer.Stop()
	}
	s.timers = make(map[int]*time.Timer)
	log.Println("[sync] Source syncer stopped")
}
```

- [ ] **Step 3: Commit**

```bash
git add agent/routing/
git commit -m "feat: add routing manager with branch routing and external source syncer"
```

---

## Task 15: Agent — Integrate Routing Manager

**Files:**
- Modify: `agent/agent/agent.go`
- Modify: `agent/wg/routing.go`

- [ ] **Step 1: Add routing manager to Agent struct**

In `agent/agent/agent.go`, add import and field:

```go
import (
	// ... existing imports
	"github.com/wiremesh/agent/routing"
)

type Agent struct {
	cfg            *config.Config
	client         *api.Client
	sse            *api.SSEClient
	activeTunnels  map[string]wg.ActiveTunnel
	routingManager *routing.Manager
	lastVersion    string
	ctx            context.Context
	cancel         context.CancelFunc
}
```

Initialize in `New()`:

```go
routingManager: routing.NewManager(),
```

- [ ] **Step 2: Integrate routing sync into pullAndApplyConfigForce**

After step 6 (Xray routing sync), add:

```go
// 7. Sync branch routing
if err := a.routingManager.Sync(cfgData.Routing); err != nil {
    log.Printf("[agent] routing sync error: %v", err)
}
```

- [ ] **Step 3: Add routing cleanup to shutdown**

In the `shutdown()` method, add before `iptables.RemoveAllWireMeshRules()`:

```go
a.routingManager.Cleanup()
```

- [ ] **Step 4: Update fwmark constants in wg/routing.go**

In `agent/wg/routing.go`, update the constants:

```go
const (
	routeTableStart     = 100   // WG device routes: tables 101-199
	xrayRouteTableStart = 42001 // Xray fwmark routes: tables 42001+ (was 200)
)
```

Update `cleanRouting()` to clean the new Xray range:

```go
// Clean Xray fwmark routes (42001-42099)
for i := xrayRouteTableStart; i <= xrayRouteTableStart+99; i++ {
    table := fmt.Sprintf("%d", i)
    markHex := fmt.Sprintf("0x%x", i)
    _, err := RunSilent("ip", "rule", "del", "fwmark", markHex, "lookup", table)
    if err != nil {
        break
    }
    RunSilent("ip", "route", "flush", "table", table)
}
```

Also update `SyncXrayRouting` — the mark values now come from the server as 42001+, so the existing code (which uses `route.Mark` directly) already works. Just update the log message prefix for clarity.

- [ ] **Step 5: Update log message in pullAndApplyConfigForce**

Update the summary log to include routing info:

```go
routingStatus := "disabled"
if cfgData.Routing != nil && cfgData.Routing.Enabled {
    routingStatus = fmt.Sprintf("enabled (%d branches)", len(cfgData.Routing.Branches))
}
log.Printf("[agent] Config applied. Tunnels: %d, iptables: %d, xray: %s, routing: %s",
    len(a.activeTunnels), len(cfgData.Tunnels.IptablesRules), xrayStatus, routingStatus)
```

- [ ] **Step 6: Commit**

```bash
git add agent/agent/agent.go agent/wg/routing.go
git commit -m "feat: integrate routing manager into agent lifecycle"
```

---

## Task 16: Agent — iptables Mangle Support

**Files:**
- Modify: `agent/iptables/rules.go`

- [ ] **Step 1: Add mangle table to listWireMeshRules**

Add mangle PREROUTING chain scanning:

```go
// mangle table PREROUTING chain — prefix with "-t mangle" for correct matching
if output, err := exec.Command("iptables", "-t", "mangle", "-S", "PREROUTING").CombinedOutput(); err == nil {
    for _, line := range strings.Split(string(output), "\n") {
        line = strings.TrimSpace(line)
        if strings.Contains(line, "wm-") && strings.HasPrefix(line, "-A ") {
            allRules = append(allRules, "-t mangle "+line)
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/iptables/rules.go
git commit -m "feat: add mangle table support to iptables rule management"
```

---

## Task 17: End-to-End Verification

- [ ] **Step 1: Build management platform**

```bash
cd /home/coder/workspaces/wiremesh && npm run build
```

Fix any TypeScript/build errors.

- [ ] **Step 2: Run existing tests**

```bash
cd /home/coder/workspaces/wiremesh && npm test
```

Fix any test failures.

- [ ] **Step 3: Build Agent**

```bash
cd /home/coder/workspaces/wiremesh/agent && go build ./...
```

Fix any compilation errors.

- [ ] **Step 4: Run Agent tests**

```bash
cd /home/coder/workspaces/wiremesh/agent && go test ./...
```

- [ ] **Step 5: Manual smoke test**

Start the dev server and verify:

1. Create a filter with IP/CIDR rules, domain rules, and an external source URL
2. Create a line with multiple branches, associating filters to non-default branches
3. View line detail — branches display correctly
4. View filter list — rules count and branch count show
5. Edit a filter — branch association persists
6. Toggle filter enable/disable works

```bash
cd /home/coder/workspaces/wiremesh && npm run dev
```

- [ ] **Step 6: Verify agent config API**

With test data in DB, call the agent config endpoint and verify the `routing` section is present:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/agent/config | jq '.data.routing'
```

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "fix: resolve build and test issues for routing rules feature"
```
