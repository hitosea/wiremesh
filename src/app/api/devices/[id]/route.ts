import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "无效的设备 ID");

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
      tags: devices.tags,
      remark: devices.remark,
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();

  if (!device) return error("NOT_FOUND", "设备不存在");
  return success(device);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "无效的设备 ID");

  const existing = db
    .select({ id: devices.id, name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "设备不存在");

  const body = await request.json();
  const { name, tags, remark } = body;

  const updateData: Partial<typeof devices.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (tags !== undefined) updateData.tags = tags;
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
      tags: devices.tags,
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
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "无效的设备 ID");

  const existing = db
    .select({ id: devices.id, name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (!existing) return error("NOT_FOUND", "设备不存在");

  db.delete(devices).where(eq(devices.id, deviceId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "device",
    targetId: deviceId,
    targetName: existing.name,
  });

  return success({ message: "设备已删除" });
}
