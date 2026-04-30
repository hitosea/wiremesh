import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { computeDeviceStatus } from "@/lib/device-status";
import { notifyLineNodes } from "@/lib/line-notify";
import { releaseLineProtocol } from "@/lib/db/protocols";
import { isXrayProtocol } from "@/lib/protocols";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "validation.invalidDeviceId");

  const device = db
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgPublicKey: devices.wgPublicKey,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
      xrayConfig: devices.xrayConfig,
      lineId: devices.lineId,
      status: devices.status,
      lastHandshake: devices.lastHandshake,
      uploadBytes: devices.uploadBytes,
      downloadBytes: devices.downloadBytes,
      connectionCount: devices.connectionCount,
      activeIps: devices.activeIps,
      remark: devices.remark,
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();

  if (!device) return error("NOT_FOUND", "notFound.device");
  return success({ ...device, status: computeDeviceStatus(device.lastHandshake) });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "validation.invalidDeviceId");

  const existing = db
    .select({ id: devices.id, name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.device");

  const body = await request.json();
  const { name, remark } = body;

  const updateData: Partial<typeof devices.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (remark !== undefined) updateData.remark = remark;

  const updated = db
    .update(devices)
    .set(updateData)
    .where(eq(devices.id, deviceId))
    .returning({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgPublicKey: devices.wgPublicKey,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
      xrayConfig: devices.xrayConfig,
      lineId: devices.lineId,
      status: devices.status,
      remark: devices.remark,
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt,
    })
    .get();

  writeAuditLog({
    action: "update",
    targetType: "device",
    targetId: deviceId,
    targetName: existing.name,
  });

  return success(updated);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "validation.invalidDeviceId");

  const existing = db
    .select({ id: devices.id, name: devices.name, protocol: devices.protocol, lineId: devices.lineId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.device");

  db.transaction((tx) => {
    tx.delete(devices).where(eq(devices.id, deviceId)).run();

    // Release line_protocols if this was the last device of the same protocol on the line
    if (existing.lineId && (isXrayProtocol(existing.protocol) || existing.protocol === "socks5")) {
      const remaining = tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.lineId, existing.lineId), eq(devices.protocol, existing.protocol)))
        .get();
      if (!remaining) {
        releaseLineProtocol(tx, existing.lineId, existing.protocol);
      }
    }
  });

  writeAuditLog({
    action: "delete",
    targetType: "device",
    targetId: deviceId,
    targetName: existing.name,
  });

  if (existing.lineId) {
    notifyLineNodes(existing.lineId);
  }

  return success({ message: "设备已删除" });
}
