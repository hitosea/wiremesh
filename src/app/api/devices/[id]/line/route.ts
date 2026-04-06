import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

type Params = { params: Promise<{ id: string }> };

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

  return success(updated);
}
