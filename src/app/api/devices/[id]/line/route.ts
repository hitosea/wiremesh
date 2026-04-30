import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyLineNodes } from "@/lib/line-notify";
import {
  ensureLineProtocol,
  releaseLineProtocol,
  enableNodeProtocol,
  isProtocolSupportedByEntryNode,
  getEntryNodeIdForLine,
  getStartPortForLine,
} from "@/lib/db/protocols";
import { isXrayProtocol, type DeviceProtocol, DEVICE_PROTOCOLS } from "@/lib/protocols";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "validation.invalidDeviceId");

  const existing = db
    .select({ id: devices.id, name: devices.name, lineId: devices.lineId, protocol: devices.protocol })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.device");
  if (!DEVICE_PROTOCOLS.includes(existing.protocol as DeviceProtocol)) {
    return error("INTERNAL_ERROR", "internal.invalidStoredProtocol");
  }
  const protocol = existing.protocol as DeviceProtocol;

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

  const oldLineId = existing.lineId;
  const newLineId: number | null = lineId ?? null;

  // Validate line and protocol compatibility BEFORE entering the transaction
  // so validation errors are returned as 4xx (not swallowed as 500s)
  let entryNodeIdForNewLine: number | null = null;
  if (newLineId) {
    entryNodeIdForNewLine = getEntryNodeIdForLine(db, newLineId);
    if (!entryNodeIdForNewLine) {
      return error("VALIDATION_ERROR", "validation.lineHasNoEntryNode");
    }
    if (isXrayProtocol(protocol)) {
      // Xray transports must be explicitly enabled on the node
      if (!isProtocolSupportedByEntryNode(db, entryNodeIdForNewLine, protocol)) {
        return error("CONFLICT", "validation.deviceProtocolNotSupported");
      }
    }
    // WireGuard / SOCKS5: lazy-create node_protocols row — handled inside transaction
  }

  const updated = db.transaction((tx) => {
    if (newLineId && entryNodeIdForNewLine) {
      if (!isXrayProtocol(protocol)) {
        // WireGuard / SOCKS5: lazy-create node_protocols row on first device
        if (!isProtocolSupportedByEntryNode(tx, entryNodeIdForNewLine, protocol)) {
          enableNodeProtocol(tx, entryNodeIdForNewLine, protocol, {});
        }
      }

      // lazy-allocate per-line port (WireGuard returns null and only marks the row)
      const startPort = getStartPortForLine(tx, newLineId);
      ensureLineProtocol(tx, newLineId, protocol, { startPort });
    }

    const result = tx
      .update(devices)
      .set({
        lineId: newLineId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(devices.id, deviceId))
      .returning({
        id: devices.id,
        name: devices.name,
        lineId: devices.lineId,
      })
      .get();

    // Release old line_protocols if no peers of the same protocol remain on old line
    if (oldLineId && oldLineId !== newLineId) {
      const peers = tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.lineId, oldLineId), eq(devices.protocol, protocol)))
        .get();
      if (!peers) {
        releaseLineProtocol(tx, oldLineId, protocol);
      }
    }

    return result;
  });

  writeAuditLog({
    action: "update",
    targetType: "device",
    targetId: deviceId,
    targetName: existing.name,
    detail: newLineId ? `lineId=${newLineId}` : "unlinked line",
  });

  // Notify all nodes on old line
  if (oldLineId && oldLineId !== newLineId) {
    notifyLineNodes(oldLineId);
  }
  // Notify all nodes on new line
  if (newLineId) {
    notifyLineNodes(newLineId);
  }

  return success(updated);
}
