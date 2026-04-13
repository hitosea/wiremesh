# Private IP Entry Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow entry nodes with private/internal IPs (RFC 1918) while ensuring only public IP nodes can serve as relay or exit.

**Architecture:** Add a shared `isPrivateIp()` utility. Backend skips WireGuard Endpoint for private IP peers. Line creation API and frontend both validate that relay/exit nodes have public IPs.

**Tech Stack:** TypeScript (Next.js), Go (agent), shadcn/ui Select (Radix)

**Spec:** `docs/superpowers/specs/2026-04-13-private-ip-entry-node-design.md`

---

### Task 1: Create `isPrivateIp()` utility

**Files:**
- Create: `src/lib/ip-utils.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// src/lib/ip-utils.ts

/**
 * Detect RFC 1918 private, loopback, and link-local addresses.
 */
export function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ip-utils.ts
git commit -m "feat: add isPrivateIp utility for RFC 1918 detection"
```

---

### Task 2: Skip Endpoint for private IP peers in agent config API

**Files:**
- Modify: `src/app/api/agent/config/route.ts:133-141`

- [ ] **Step 1: Add import**

At the top of `src/app/api/agent/config/route.ts`, add:

```typescript
import { isPrivateIp } from "@/lib/ip-utils";
```

- [ ] **Step 2: Modify the "to" branch to skip Endpoint for private IP from-nodes**

In the `else` block (lines 133-141), change line 138 from:

```typescript
peerAddress = getNodePublicHost(tunnel.fromNodeId);
```

to:

```typescript
const fromHost = getNodePublicHost(tunnel.fromNodeId);
peerAddress = isPrivateIp(fromHost) ? "" : fromHost;
```

Note: `getNodePublicHost` returns `domain || ip`. If a domain is set, it's not a raw IP so `isPrivateIp` returns false — correct behavior since a domain implies the node is reachable.

The "from" branch (line 130) stays unchanged — the from-node always needs the to-node's public Endpoint to initiate the connection.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat: skip WireGuard Endpoint for private IP peers in agent config"
```

---

### Task 3: Agent — conditionally write Endpoint in tunnel config

**Files:**
- Modify: `agent/wg/tunnel.go:128`

- [ ] **Step 1: Modify `writeTunnelConf` to conditionally write Endpoint**

In `agent/wg/tunnel.go`, change line 128 from:

```go
sb.WriteString(fmt.Sprintf("Endpoint = %s:%d\n", iface.PeerAddress, iface.PeerPort))
```

to:

```go
if iface.PeerAddress != "" {
    sb.WriteString(fmt.Sprintf("Endpoint = %s:%d\n", iface.PeerAddress, iface.PeerPort))
}
```

- [ ] **Step 2: Build agent to verify compilation**

```bash
cd agent && go build ./...
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add agent/wg/tunnel.go
git commit -m "feat: agent skips WireGuard Endpoint when peerAddress is empty"
```

---

### Task 4: Line creation API — validate no private IP in relay/exit

**Files:**
- Modify: `src/app/api/lines/route.ts:119-135`

- [ ] **Step 1: Add import**

At the top of `src/app/api/lines/route.ts`, add:

```typescript
import { isPrivateIp } from "@/lib/ip-utils";
```

- [ ] **Step 2: Add private IP validation after node existence check**

After the existing node existence validation loop (line 135, after the closing `}`), insert:

```typescript
  // Verify no private IP nodes in relay/exit positions
  for (const nodeId of allBranchNodeIds) {
    const nodeRow = db
      .select({ id: nodes.id, name: nodes.name, ip: nodes.ip })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .get();
    if (nodeRow && isPrivateIp(nodeRow.ip)) {
      return error("VALIDATION_ERROR", "validation.privateIpNotAllowedAsRelayOrExit", { name: nodeRow.name });
    }
  }
```

Note: This reuses `allBranchNodeIds` which was already collected above (lines 120-125). The entry node (`entryNodeId`) is not in this set, so it's not checked — private IP entry nodes are allowed.

Optimization: the existing loop at lines 126-134 already queries each node. To avoid a second query, merge the private IP check into the existing loop by changing the select to include `name` and `ip`:

Replace lines 126-134:

```typescript
  for (const nodeId of allBranchNodeIds) {
    const node = db
      .select({ id: nodes.id, name: nodes.name, ip: nodes.ip })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .get();
    if (!node) {
      return error("VALIDATION_ERROR", "validation.nodeNotFound", { id: nodeId });
    }
    if (isPrivateIp(node.ip)) {
      return error("VALIDATION_ERROR", "validation.privateIpNotAllowedAsRelayOrExit", { name: node.name });
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/lines/route.ts
git commit -m "feat: reject private IP nodes in relay/exit positions during line creation"
```

---

### Task 5: i18n — add validation message and update IP placeholder

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add validation error key to zh-CN.json**

In the `validation` section of `messages/zh-CN.json`, add:

```json
"privateIpNotAllowedAsRelayOrExit": "节点 \"{name}\" 使用内网 IP，不能作为中继或出口节点"
```

- [ ] **Step 2: Add validation error key to en.json**

In the `validation` section of `messages/en.json`, add:

```json
"privateIpNotAllowedAsRelayOrExit": "Node \"{name}\" uses a private IP and cannot be used as relay or exit"
```

- [ ] **Step 3: Update IP placeholder in zh-CN.json**

Change `ipPlaceholder` from:

```json
"ipPlaceholder": "例如：1.2.3.4"
```

to:

```json
"ipPlaceholder": "例如 1.2.3.4 或 192.168.1.100"
```

- [ ] **Step 4: Update IP placeholder in en.json**

Change `ipPlaceholder` from:

```json
"ipPlaceholder": "e.g., 1.2.3.4"
```

to:

```json
"ipPlaceholder": "e.g., 1.2.3.4 or 192.168.1.100"
```

- [ ] **Step 5: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git commit -m "feat: add private IP validation message and update IP placeholder for i18n"
```

---

### Task 6: Frontend — disable private IP nodes in branch node selects

**Files:**
- Modify: `src/app/(dashboard)/lines/new/page.tsx:27-31, 398-403`

- [ ] **Step 1: Add import**

At the top of `src/app/(dashboard)/lines/new/page.tsx`, add:

```typescript
import { isPrivateIp } from "@/lib/ip-utils";
```

- [ ] **Step 2: Modify branch node SelectItem to disable private IP nodes**

In the branch node dropdown (lines 399-402), change:

```tsx
{nodeOptions.map((n) => (
  <SelectItem key={n.id} value={String(n.id)}>
    {n.name} ({n.ip})
  </SelectItem>
))}
```

to:

```tsx
{nodeOptions.map((n) => (
  <SelectItem key={n.id} value={String(n.id)} disabled={isPrivateIp(n.ip)}>
    {n.name} ({n.ip}){isPrivateIp(n.ip) ? ` (${t("privateIpTag")})` : ""}
  </SelectItem>
))}
```

The entry node `Select` (lines 303-314) is NOT modified — private IP nodes can be selected as entry.

- [ ] **Step 3: Add `privateIpTag` i18n key**

In `messages/zh-CN.json`, in the lines section, add:

```json
"privateIpTag": "内网"
```

In `messages/en.json`, in the lines section, add:

```json
"privateIpTag": "LAN"
```

- [ ] **Step 4: Verify the dev server runs without errors**

```bash
npm run dev
```

Check the browser: create a line, verify private IP nodes show as greyed out and unselectable in branch node dropdowns.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/lines/new/page.tsx messages/zh-CN.json messages/en.json
git commit -m "feat: disable private IP nodes in branch relay/exit dropdowns"
```

---

### Task 7: Verify end-to-end

- [ ] **Step 1: Run build to check for compilation errors**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 2: Run agent build**

```bash
cd agent && go build ./...
```

Expected: Build succeeds.

- [ ] **Step 3: Manual verification checklist**

1. Create a node with IP `192.168.1.100` — should succeed
2. Create a node with IP `8.8.8.8` — should succeed
3. Create a line with private IP node as entry, public IP node as exit — should succeed
4. Create a line with private IP node as relay or exit — API should return `privateIpNotAllowedAsRelayOrExit` error; frontend dropdown should show the node greyed out with "(内网)" tag
5. Check agent config for a line with private IP entry: the exit node's tunnel config should have empty `peerAddress`, meaning no `Endpoint` line in WireGuard config
