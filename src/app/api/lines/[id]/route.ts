import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lines, lineNodes, lineTunnels, nodes, devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, count } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  if (isNaN(lineId)) return error("VALIDATION_ERROR", "无效的线路 ID");

  const line = db
    .select()
    .from(lines)
    .where(eq(lines.id, lineId))
    .get();
  if (!line) return error("NOT_FOUND", "线路不存在");

  // Join line_nodes + nodes
  const lineNodeRows = db
    .select({
      hopOrder: lineNodes.hopOrder,
      role: lineNodes.role,
      nodeId: lineNodes.nodeId,
      nodeName: nodes.name,
      nodeStatus: nodes.status,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(eq(lineNodes.lineId, lineId))
    .orderBy(lineNodes.hopOrder)
    .all();

  // Get tunnels (strip private keys)
  const tunnelRows = db
    .select({
      id: lineTunnels.id,
      hopIndex: lineTunnels.hopIndex,
      fromNodeId: lineTunnels.fromNodeId,
      toNodeId: lineTunnels.toNodeId,
      fromWgPublicKey: lineTunnels.fromWgPublicKey,
      fromWgAddress: lineTunnels.fromWgAddress,
      fromWgPort: lineTunnels.fromWgPort,
      toWgPublicKey: lineTunnels.toWgPublicKey,
      toWgAddress: lineTunnels.toWgAddress,
      toWgPort: lineTunnels.toWgPort,
    })
    .from(lineTunnels)
    .where(eq(lineTunnels.lineId, lineId))
    .orderBy(lineTunnels.hopIndex)
    .all();

  // Enrich tunnels with node names
  const nodeMap: Record<number, string> = {};
  for (const n of lineNodeRows) {
    nodeMap[n.nodeId] = n.nodeName;
  }
  const tunnels = tunnelRows.map((t) => ({
    ...t,
    fromNodeName: nodeMap[t.fromNodeId] ?? String(t.fromNodeId),
    toNodeName: nodeMap[t.toNodeId] ?? String(t.toNodeId),
  }));

  // Count associated devices
  const deviceCount =
    db
      .select({ count: count() })
      .from(devices)
      .where(eq(devices.lineId, lineId))
      .get()?.count ?? 0;

  return success({ ...line, nodes: lineNodeRows, tunnels, deviceCount });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  if (isNaN(lineId)) return error("VALIDATION_ERROR", "无效的线路 ID");

  const existing = db
    .select({ id: lines.id, name: lines.name })
    .from(lines)
    .where(eq(lines.id, lineId))
    .get();
  if (!existing) return error("NOT_FOUND", "线路不存在");

  const body = await request.json();
  const { name, status, tags, remark } = body;

  const updateData: Partial<typeof lines.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (status !== undefined) updateData.status = status;
  if (tags !== undefined) updateData.tags = tags;
  if (remark !== undefined) updateData.remark = remark;

  const updated = db
    .update(lines)
    .set(updateData)
    .where(eq(lines.id, lineId))
    .returning()
    .get();

  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: lineId,
    targetName: existing.name,
  });

  return success(updated);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  if (isNaN(lineId)) return error("VALIDATION_ERROR", "无效的线路 ID");

  const existing = db
    .select({ id: lines.id, name: lines.name })
    .from(lines)
    .where(eq(lines.id, lineId))
    .get();
  if (!existing) return error("NOT_FOUND", "线路不存在");

  // Collect node IDs before deleting
  const affectedNodeIds = db
    .select({ nodeId: lineNodes.nodeId })
    .from(lineNodes)
    .where(eq(lineNodes.lineId, lineId))
    .all()
    .map((r) => r.nodeId);

  // Unlink devices first
  db.update(devices)
    .set({ lineId: null })
    .where(eq(devices.lineId, lineId))
    .run();

  // Delete line (cascade handles line_nodes and line_tunnels)
  db.delete(lines).where(eq(lines.id, lineId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "line",
    targetId: lineId,
    targetName: existing.name,
  });

  for (const nodeId of affectedNodeIds) {
    sseManager.notifyNodeTunnelUpdate(nodeId);
  }

  return success({ message: "线路已删除" });
}
