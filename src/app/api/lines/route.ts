import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lines, lineNodes, lineTunnels, lineBranches, branchFilters, nodes, settings, filters } from "@/lib/db/schema";
import { created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, like, count, and, sql, SQL, inArray } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateTunnelSubnet, allocateTunnelPort } from "@/lib/ip-allocator";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";
import { isPrivateIp } from "@/lib/ip-utils";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");

  const conditions: SQL[] = [];
  if (search) conditions.push(like(lines.name, `%${search}%`));
  if (status) conditions.push(eq(lines.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db.select({ count: count() }).from(lines).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(lines)
    .where(where)
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  const result = rows.map((line) => {
    const lineNodeRows = db
      .select({
        hopOrder: lineNodes.hopOrder,
        role: lineNodes.role,
        nodeId: lineNodes.nodeId,
        nodeName: nodes.name,
        branchId: lineNodes.branchId,
      })
      .from(lineNodes)
      .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
      .where(eq(lineNodes.lineId, line.id))
      .orderBy(lineNodes.hopOrder)
      .all();

    const branchRows = db
      .select()
      .from(lineBranches)
      .where(eq(lineBranches.lineId, line.id))
      .all();

    return { ...line, nodes: lineNodeRows, branches: branchRows };
  });

  return paginated(result, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

interface BranchInput {
  name: string;
  isDefault: boolean;
  nodeIds: number[];
  filterIds?: number[];
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, entryNodeId, branches, remark } = body as {
    name?: string;
    entryNodeId?: number;
    branches?: BranchInput[];
    remark?: string;
  };

  // --- Validation ---
  if (!name || !name.trim()) {
    return error("VALIDATION_ERROR", "validation.nameRequired");
  }
  if (!entryNodeId) {
    return error("VALIDATION_ERROR", "validation.entryNodeRequired");
  }
  if (!branches || !Array.isArray(branches) || branches.length < 1) {
    return error("VALIDATION_ERROR", "validation.branchesRequired");
  }

  // Validate exactly one default branch
  const defaultCount = branches.filter((b) => b.isDefault).length;
  if (defaultCount !== 1) {
    return error("VALIDATION_ERROR", "validation.exactlyOneDefaultBranch");
  }

  // Validate each branch
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    if (!branch.name || !branch.name.trim()) {
      return error("VALIDATION_ERROR", "validation.branchNameRequired", { index: i + 1 });
    }
    if (!branch.nodeIds || !Array.isArray(branch.nodeIds)) {
      return error("VALIDATION_ERROR", "validation.branchNeedsNode", { name: branch.name });
    }
    // Forbid self-loop tunnels: entry node cannot appear in branch nodes.
    // Users who want the entry to be the exit should use direct-exit (nodeIds = []) instead.
    if (branch.nodeIds.includes(entryNodeId)) {
      return error("VALIDATION_ERROR", "validation.branchContainsEntryNode", { name: branch.name });
    }
    // Forbid duplicate nodes within a single branch chain (e.g. A → B → A or A → A).
    // Why: agent config keys downstream/upstream tunnels by lineId, so a node
    // appearing twice in the same chain would have its Map entries overwritten —
    // the redundant hops silently drop traffic instead of forming a loop.
    const seenInBranch = new Set<number>();
    for (const nodeId of branch.nodeIds) {
      if (seenInBranch.has(nodeId)) {
        return error("VALIDATION_ERROR", "validation.duplicateNodeInBranch", { name: branch.name });
      }
      seenInBranch.add(nodeId);
    }
  }

  // Verify entry node exists
  const entryNode = db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.id, entryNodeId))
    .get();
  if (!entryNode) {
    return error("VALIDATION_ERROR", "validation.entryNodeNotFound", { id: entryNodeId });
  }

  // Collect all nodeIds from branches and verify they exist
  const allBranchNodeIds = new Set<number>();
  for (const branch of branches) {
    for (const nodeId of branch.nodeIds) {
      allBranchNodeIds.add(nodeId);
    }
  }
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

  // Collect and verify all filterIds
  const allFilterIds = new Set<number>();
  for (const branch of branches) {
    if (branch.filterIds) {
      for (const filterId of branch.filterIds) {
        allFilterIds.add(filterId);
      }
    }
  }
  for (const filterId of allFilterIds) {
    const filter = db
      .select({ id: filters.id })
      .from(filters)
      .where(eq(filters.id, filterId))
      .get();
    if (!filter) {
      return error("VALIDATION_ERROR", "validation.filterNotFound", { id: filterId });
    }
  }

  // --- Read settings ---
  const settingsRows = db.select().from(settings).all();
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) {
    settingsMap[row.key] = row.value;
  }
  const tunnelSubnet = settingsMap["tunnel_subnet"] ?? "10.211.0.0/16";
  const tunnelPortStart = parseInt(settingsMap["tunnel_port_start"] ?? "41830");

  // --- Read existing tunnels for allocation ---
  const existingTunnels = db.select().from(lineTunnels).all();
  const usedAddresses: string[] = existingTunnels.flatMap((t) => [
    t.fromWgAddress,
    t.toWgAddress,
  ]);
  const usedPorts: number[] = existingTunnels.flatMap((t) => [
    t.fromWgPort,
    t.toWgPort,
  ]);

  // --- Creation flow ---

  // 1. Insert line record
  const line = db
    .insert(lines)
    .values({
      name: name.trim(),
      status: "active",
      remark: remark ?? null,
    })
    .returning()
    .get();

  // 2. Insert entry node (branchId: null, role: "entry", hopOrder: 0)
  db.insert(lineNodes)
    .values({
      lineId: line.id,
      nodeId: entryNodeId,
      branchId: null,
      hopOrder: 0,
      role: "entry",
    })
    .run();

  // Track all affected node IDs for SSE notification
  const affectedNodeIds = new Set<number>([entryNodeId]);

  // 3. For each branch
  let globalHopIndex = 0; // tunnel hop index across all branches

  for (const branch of branches) {
    // 3a. Insert into lineBranches
    const branchRecord = db
      .insert(lineBranches)
      .values({
        lineId: line.id,
        name: branch.name.trim(),
        isDefault: branch.isDefault,
      })
      .returning()
      .get();

    // 3b. Insert branch nodes into lineNodes
    // When nodeIds is empty, entry node serves as both entry and exit (no tunnels needed)
    if (branch.nodeIds.length > 0) {
      for (let i = 0; i < branch.nodeIds.length; i++) {
        const nodeId = branch.nodeIds[i];
        const isLast = i === branch.nodeIds.length - 1;
        const role = isLast ? "exit" : "relay";
        const hopOrder = i + 1; // entry is 0, branch nodes start from 1

        db.insert(lineNodes)
          .values({
            lineId: line.id,
            nodeId,
            branchId: branchRecord.id,
            hopOrder,
            role,
          })
          .run();

        affectedNodeIds.add(nodeId);
      }

      // 3c. Create lineTunnels for the chain: entry → first branch node, then sequential
      const chainNodeIds = [entryNodeId, ...branch.nodeIds];
      for (let i = 0; i < chainNodeIds.length - 1; i++) {
        const fromNodeId = chainNodeIds[i];
        const toNodeId = chainNodeIds[i + 1];

        const { fromAddress, toAddress } = allocateTunnelSubnet(
          usedAddresses,
          tunnelSubnet
        );
        usedAddresses.push(fromAddress, toAddress);

        const fromPort = allocateTunnelPort(usedPorts, tunnelPortStart);
        usedPorts.push(fromPort);
        const toPort = allocateTunnelPort(usedPorts, tunnelPortStart);
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
    }

    // 3d. Insert branchFilters associations.
    // Skip for default branches (catch-all, ignored by config builder).
    // Direct-exit branches are allowed — they route matching traffic out the
    // entry node's external interface via fwmark → branch table → extIface.
    const canBindFilters = !branch.isDefault;
    if (canBindFilters && branch.filterIds && branch.filterIds.length > 0) {
      for (const filterId of branch.filterIds) {
        db.insert(branchFilters)
          .values({
            branchId: branchRecord.id,
            filterId,
          })
          .run();
      }
    }
  }

  // 4. Write audit log
  const branchSummary = branches.map((b) => `${b.name}:[${b.nodeIds.join(",")}]`).join("; ");
  writeAuditLog({
    action: "create",
    targetType: "line",
    targetId: line.id,
    targetName: name.trim(),
    detail: `entry=${entryNodeId}, branches: ${branchSummary}`,
  });

  // 5. Bump updatedAt on all affected nodes so agent detects config version change
  const affectedIds = [...affectedNodeIds];
  if (affectedIds.length > 0) {
    db.update(nodes)
      .set({ updatedAt: sql`(datetime('now'))` })
      .where(inArray(nodes.id, affectedIds))
      .run();
  }

  // 6. SSE notify all affected nodes
  for (const nodeId of affectedNodeIds) {
    sseManager.notifyNodeTunnelUpdate(nodeId);
  }

  return created(line);
}
