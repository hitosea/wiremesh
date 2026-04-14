import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lines, lineNodes, nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and, sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";
import { allocateProxyPort, getXrayDefaultPort } from "@/lib/proxy-port";

function getEntryNodeId(lineId: number): number | null {
  const entry = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry"))).get();
  return entry?.nodeId ?? null;
}

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "validation.invalidDeviceId");

  const existing = db
    .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.device");

  const body = await request.json();
  const { lineId } = body;

  // Validate line exists if lineId is provided
  if (lineId !== null && lineId !== undefined) {
    const line = db
      .select({ id: lines.id })
      .from(lines)
      .where(eq(lines.id, lineId))
      .get();
    if (!line) return error("NOT_FOUND", "notFound.line");
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

  // Allocate proxy port if moving an xray/socks5 device to a line that lacks one
  if (lineId) {
    const device = db.select({ protocol: devices.protocol }).from(devices)
      .where(eq(devices.id, deviceId)).get();
    if (device && (device.protocol === "xray" || device.protocol === "socks5")) {
      const portField = device.protocol === "xray" ? "xrayPort" : "socks5Port";
      const line = db.select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
        .from(lines).where(eq(lines.id, lineId)).get();
      const entryNodeId = getEntryNodeId(lineId);
      if (line && line[portField] === null && entryNodeId !== null) {
        const nodeRow = db.select({ xrayPort: nodes.xrayPort }).from(nodes)
          .where(eq(nodes.id, entryNodeId)).get();
        const basePort = nodeRow?.xrayPort ?? getXrayDefaultPort();
        const port = allocateProxyPort(entryNodeId, basePort);
        db.update(lines).set({ [portField]: port }).where(eq(lines.id, lineId)).run();
      }
    }
  }

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
      db.update(nodes).set({ updatedAt: sql`(datetime('now'))` }).where(eq(nodes.id, oldEntryNodeId)).run();
      sseManager.notifyNodePeerUpdate(oldEntryNodeId);
    }
  }
  // Notify new entry node
  if (lineId) {
    const newEntryNodeId = getEntryNodeId(lineId);
    if (newEntryNodeId !== null) {
      db.update(nodes).set({ updatedAt: sql`(datetime('now'))` }).where(eq(nodes.id, newEntryNodeId)).run();
      sseManager.notifyNodePeerUpdate(newEntryNodeId);
    }
  }

  return success(updated);
}
