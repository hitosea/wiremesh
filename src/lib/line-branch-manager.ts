import { db } from "@/lib/db";
import { branchFilters, filters, lineBranches, lineNodes, lineTunnels, nodes, settings } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateTunnelPort, allocateTunnelSubnet, parseTunnelPortBlacklist } from "@/lib/ip-allocator";
import { isPrivateIp } from "@/lib/ip-utils";
import { sseManager } from "@/lib/sse-manager";
import { and, eq, inArray, sql } from "drizzle-orm";

export type BranchInput = {
  name: string;
  isDefault: boolean;
  nodeIds: number[];
  filterIds?: number[];
};

export type BranchValidationError = {
  message: string;
  params?: Record<string, string | number>;
};

type DbLike = typeof db;

type AllocationState = {
  usedAddresses: string[];
  usedPorts: number[];
  tunnelSubnet: string;
  tunnelPortStart: number;
  nodeBlacklistById: Map<number, string>;
};

export function getEntryNodeId(lineId: number): number | null {
  const entry = db
    .select({ nodeId: lineNodes.nodeId })
    .from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry")))
    .get();
  return entry?.nodeId ?? null;
}

export function getLineParticipantNodeIds(lineId: number): number[] {
  return db
    .select({ nodeId: lineNodes.nodeId })
    .from(lineNodes)
    .where(eq(lineNodes.lineId, lineId))
    .all()
    .map((r) => r.nodeId);
}

export function getBranchNonEntryParticipantNodeIds(branchId: number, entryNodeId: number): number[] {
  const fromNodes = db
    .select({ nodeId: lineTunnels.fromNodeId })
    .from(lineTunnels)
    .where(eq(lineTunnels.branchId, branchId))
    .all()
    .map((r) => r.nodeId);
  const toNodes = db
    .select({ nodeId: lineTunnels.toNodeId })
    .from(lineTunnels)
    .where(eq(lineTunnels.branchId, branchId))
    .all()
    .map((r) => r.nodeId);
  const branchNodes = db
    .select({ nodeId: lineNodes.nodeId })
    .from(lineNodes)
    .where(eq(lineNodes.branchId, branchId))
    .all()
    .map((r) => r.nodeId);
  return [...new Set([...fromNodes, ...toNodes, ...branchNodes])].filter((nodeId) => nodeId !== entryNodeId);
}

export function notifyNodeIds(nodeIds: Iterable<number>): void {
  const ids = [...new Set([...nodeIds])];
  if (ids.length === 0) return;
  db.update(nodes)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(inArray(nodes.id, ids))
    .run();
  for (const nodeId of ids) {
    sseManager.notifyNodeTunnelUpdate(nodeId);
  }
}

export function validateBranchInput(input: BranchInput, entryNodeId: number): BranchValidationError | null {
  if (!input.name || !input.name.trim()) {
    return { message: "validation.branchNameRequiredSimple" };
  }
  if (!Array.isArray(input.nodeIds)) {
    return { message: "validation.branchNeedsNode", params: { name: input.name } };
  }
  if (input.nodeIds.includes(entryNodeId)) {
    return { message: "validation.branchContainsEntryNode", params: { name: input.name } };
  }

  const seenInBranch = new Set<number>();
  for (const nodeId of input.nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      return { message: "validation.nodeNotFound", params: { id: String(nodeId) } };
    }
    if (seenInBranch.has(nodeId)) {
      return { message: "validation.duplicateNodeInBranch", params: { name: input.name } };
    }
    seenInBranch.add(nodeId);
  }

  for (const nodeId of seenInBranch) {
    const node = db
      .select({ id: nodes.id, name: nodes.name, ip: nodes.ip })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .get();
    if (!node) {
      return { message: "validation.nodeNotFound", params: { id: nodeId } };
    }
    if (isPrivateIp(node.ip)) {
      return { message: "validation.privateIpNotAllowedAsRelayOrExit", params: { name: node.name } };
    }
  }

  for (const filterId of new Set(input.filterIds ?? [])) {
    if (!Number.isInteger(filterId) || filterId <= 0) {
      return { message: "validation.filterNotFound", params: { id: String(filterId) } };
    }
    const filter = db.select({ id: filters.id }).from(filters).where(eq(filters.id, filterId)).get();
    if (!filter) {
      return { message: "validation.filterNotFound", params: { id: filterId } };
    }
  }

  return null;
}

export function buildAllocationState(participantNodeIds: number[], excludeBranchIds: number[] = []): AllocationState {
  const settingsRows = db.select().from(settings).all();
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) settingsMap[row.key] = row.value;

  const excluded = new Set(excludeBranchIds);
  const existingTunnels = db
    .select()
    .from(lineTunnels)
    .all()
    .filter((t) => t.branchId === null || !excluded.has(t.branchId));

  const blacklistTargetIds = [...new Set(participantNodeIds)];
  const blacklistRows = db
    .select({ id: nodes.id, blacklist: nodes.tunnelPortBlacklist })
    .from(nodes)
    .where(inArray(nodes.id, blacklistTargetIds))
    .all();

  return {
    usedAddresses: existingTunnels.flatMap((t) => [t.fromWgAddress, t.toWgAddress]),
    usedPorts: existingTunnels.flatMap((t) => [t.fromWgPort, t.toWgPort]),
    tunnelSubnet: settingsMap["tunnel_subnet"] ?? "10.211.0.0/16",
    tunnelPortStart: parseInt(settingsMap["tunnel_port_start"] ?? "41830", 10),
    nodeBlacklistById: new Map(blacklistRows.map((r) => [r.id, r.blacklist])),
  };
}

function nextHopIndex(conn: DbLike, lineId: number): number {
  const rows = conn
    .select({ hopIndex: lineTunnels.hopIndex })
    .from(lineTunnels)
    .where(eq(lineTunnels.lineId, lineId))
    .all();
  return rows.reduce((max, row) => Math.max(max, row.hopIndex), -1) + 1;
}

export function normalizeLineTunnelHopIndexes(tx: DbLike, lineId: number): void {
  const branches = tx
    .select({ id: lineBranches.id })
    .from(lineBranches)
    .where(eq(lineBranches.lineId, lineId))
    .orderBy(lineBranches.id)
    .all();
  const branchIds = new Set(branches.map((b) => b.id));

  const tunnels = tx
    .select({
      id: lineTunnels.id,
      branchId: lineTunnels.branchId,
      hopIndex: lineTunnels.hopIndex,
    })
    .from(lineTunnels)
    .where(eq(lineTunnels.lineId, lineId))
    .orderBy(lineTunnels.hopIndex)
    .all();

  const ordered = [
    ...tunnels.filter((t) => t.branchId === null || !branchIds.has(t.branchId)),
    ...branches.flatMap((branch) =>
      tunnels.filter((t) => t.branchId === branch.id).sort((a, b) => a.hopIndex - b.hopIndex)
    ),
  ];

  ordered.forEach((tunnel, index) => {
    if (tunnel.hopIndex !== index) {
      tx.update(lineTunnels)
        .set({ hopIndex: index })
        .where(eq(lineTunnels.id, tunnel.id))
        .run();
    }
  });
}

export function insertBranchTopology(
  tx: DbLike,
  lineId: number,
  branchId: number,
  entryNodeId: number,
  nodeIds: number[],
  allocation: AllocationState,
): void {
  if (nodeIds.length === 0) return;

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    tx.insert(lineNodes)
      .values({
        lineId,
        nodeId,
        branchId,
        hopOrder: i + 1,
        role: i === nodeIds.length - 1 ? "exit" : "relay",
      })
      .run();
  }

  const chainNodeIds = [entryNodeId, ...nodeIds];
  let hopIndex = nextHopIndex(tx, lineId);
  for (let i = 0; i < chainNodeIds.length - 1; i++) {
    const fromNodeId = chainNodeIds[i];
    const toNodeId = chainNodeIds[i + 1];

    const { fromAddress, toAddress } = allocateTunnelSubnet(allocation.usedAddresses, allocation.tunnelSubnet);
    allocation.usedAddresses.push(fromAddress, toAddress);

    const fromBlacklist = allocation.nodeBlacklistById.get(fromNodeId);
    const toBlacklist = allocation.nodeBlacklistById.get(toNodeId);
    if (fromBlacklist === undefined || toBlacklist === undefined) {
      throw new Error(`Node disappeared during branch topology update: ${fromBlacklist === undefined ? fromNodeId : toNodeId}`);
    }
    const portBlacklist = new Set([
      ...parseTunnelPortBlacklist(fromBlacklist),
      ...parseTunnelPortBlacklist(toBlacklist),
    ]);

    const fromPort = allocateTunnelPort(allocation.usedPorts, allocation.tunnelPortStart, portBlacklist);
    allocation.usedPorts.push(fromPort);
    const toPort = allocateTunnelPort(allocation.usedPorts, allocation.tunnelPortStart, portBlacklist);
    allocation.usedPorts.push(toPort);

    const fromKeyPair = generateKeyPair();
    const toKeyPair = generateKeyPair();

    tx.insert(lineTunnels)
      .values({
        lineId,
        hopIndex: hopIndex++,
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
        branchId,
      })
      .run();
  }
}

export function replaceBranchTopology(
  tx: DbLike,
  lineId: number,
  branchId: number,
  entryNodeId: number,
  nodeIds: number[],
  allocation: AllocationState,
): void {
  tx.delete(lineTunnels).where(eq(lineTunnels.branchId, branchId)).run();
  tx.delete(lineNodes).where(eq(lineNodes.branchId, branchId)).run();
  insertBranchTopology(tx, lineId, branchId, entryNodeId, nodeIds, allocation);
}

export function replaceBranchFilters(tx: DbLike, branchId: number, isDefault: boolean, filterIds: number[] = []): void {
  tx.delete(branchFilters).where(eq(branchFilters.branchId, branchId)).run();
  if (isDefault) return;
  for (const filterId of new Set(filterIds)) {
    tx.insert(branchFilters).values({ branchId, filterId }).run();
  }
}

export function getBranchDetail(branchId: number) {
  const branch = db.select().from(lineBranches).where(eq(lineBranches.id, branchId)).get();
  if (!branch) return null;

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
}
