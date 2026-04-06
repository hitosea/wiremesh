import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lines, lineNodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

function getEntryNodeId(lineId: number): number | null {
  const entry = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry"))).get();
  return entry?.nodeId ?? null;
}

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "无效的设备 ID");

  const existing = db
    .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "设备不存在");

  const body = await request.json();
  const { lineId } = body;

  // Validate line exists if lineId is provided
  if (lineId !== null && lineId !== undefined) {
    const line = db
      .select({ id: lines.id })
      .from(lines)
      .where(eq(lines.id, lineId))
      .get();
    if (!line) return error("NOT_FOUND", "线路不存在");
  }

  const updated = db
    .update(devices)
    .set({
      lineId: lineId ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(devices.id, deviceId))
    .returning({
      id: devices.id,
      name: devices.name,
      lineId: devices.lineId,
    })
    .get();

  writeAuditLog({
    action: "update",
    targetType: "device",
    targetId: deviceId,
    targetName: existing.name,
    detail: lineId ? `lineId=${lineId}` : "unlinked line",
  });

  // Notify old entry node
  if (existing.lineId && existing.lineId !== lineId) {
    const oldEntryNodeId = getEntryNodeId(existing.lineId);
    if (oldEntryNodeId !== null) {
      sseManager.notifyNodePeerUpdate(oldEntryNodeId);
    }
  }
  // Notify new entry node
  if (lineId) {
    const newEntryNodeId = getEntryNodeId(lineId);
    if (newEntryNodeId !== null) {
      sseManager.notifyNodePeerUpdate(newEntryNodeId);
    }
  }

  return success(updated);
}
