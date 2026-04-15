import { db } from "@/lib/db";
import { devices, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { inArray, eq, sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyLineNodes } from "@/lib/line-notify";

export async function POST(request: Request) {
  const body = await request.json();
  const { action, ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error("VALIDATION_ERROR", "validation.selectAtLeastOneDevice");
  }

  if (action === "delete") {
    const existing = db
      .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
      .from(devices)
      .where(inArray(devices.id, ids))
      .all();

    const affectedLineIds = new Set<number>();
    for (const device of existing) {
      if (device.lineId) affectedLineIds.add(device.lineId);
    }

    db.delete(devices).where(inArray(devices.id, ids)).run();

    for (const device of existing) {
      writeAuditLog({
        action: "delete",
        targetType: "device",
        targetId: device.id,
        targetName: device.name,
        detail: "批量删除",
      });
    }

    for (const lineId of affectedLineIds) {
      notifyLineNodes(lineId);
    }

    return success({ message: `已删除 ${existing.length} 个设备` });
  }

  if (action === "switchLine") {
    const { lineId } = body;

    if (lineId !== null) {
      const line = db.select({ id: lines.id }).from(lines).where(eq(lines.id, lineId)).get();
      if (!line) return error("NOT_FOUND", "notFound.line");
    }

    const existing = db
      .select({ id: devices.id, name: devices.name, lineId: devices.lineId })
      .from(devices)
      .where(inArray(devices.id, ids))
      .all();

    const affectedLineIds = new Set<number>();
    for (const device of existing) {
      if (device.lineId) affectedLineIds.add(device.lineId);
    }

    db.update(devices)
      .set({ lineId: lineId, updatedAt: sql`(datetime('now'))` })
      .where(inArray(devices.id, ids))
      .run();

    if (lineId !== null) affectedLineIds.add(lineId);

    for (const device of existing) {
      writeAuditLog({
        action: "update",
        targetType: "device",
        targetId: device.id,
        targetName: device.name,
        detail: lineId ? `批量切换线路: ${lineId}` : "批量取消线路绑定",
      });
    }

    for (const lineId of affectedLineIds) {
      notifyLineNodes(lineId);
    }

    return success({ message: `已更新 ${ids.length} 个设备的线路` });
  }

  return error("VALIDATION_ERROR", "validation.invalidActionType");
}
