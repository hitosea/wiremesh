import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subscriptionGroups, subscriptionGroupDevices, devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and, ne } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const groupId = parseInt(id);
  if (isNaN(groupId)) return error("VALIDATION_ERROR", "validation.invalidId");

  const group = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.id, groupId))
    .get();
  if (!group) return error("NOT_FOUND", "notFound.subscription");

  const deviceRows = db
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      status: devices.status,
      lineId: devices.lineId,
    })
    .from(subscriptionGroupDevices)
    .innerJoin(devices, eq(subscriptionGroupDevices.deviceId, devices.id))
    .where(eq(subscriptionGroupDevices.groupId, groupId))
    .all();

  return success({ ...group, devices: deviceRows });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const groupId = parseInt(id);
  if (isNaN(groupId)) return error("VALIDATION_ERROR", "validation.invalidId");

  const body = await request.json();
  const { name, remark } = body as { name?: string; remark?: string };

  const existing = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.id, groupId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.subscription");

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (typeof name === "string") {
    if (!name.trim()) return error("VALIDATION_ERROR", "validation.nameRequired");
    const conflict = db
      .select({ id: subscriptionGroups.id })
      .from(subscriptionGroups)
      .where(and(eq(subscriptionGroups.name, name.trim()), ne(subscriptionGroups.id, groupId)))
      .get();
    if (conflict) return error("CONFLICT", "subscriptions.errors.nameTaken");
    update.name = name.trim();
  }
  if (typeof remark === "string" || remark === null) {
    update.remark = typeof remark === "string" ? (remark.trim() || null) : null;
  }

  db.update(subscriptionGroups)
    .set(update)
    .where(eq(subscriptionGroups.id, groupId))
    .run();

  const after = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.id, groupId))
    .get();

  writeAuditLog({
    action: "update",
    targetType: "subscription",
    targetId: groupId,
    targetName: after?.name ?? existing.name,
  });

  return success(after);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const groupId = parseInt(id);
  if (isNaN(groupId)) return error("VALIDATION_ERROR", "validation.invalidId");

  const existing = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.id, groupId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.subscription");

  db.delete(subscriptionGroups).where(eq(subscriptionGroups.id, groupId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "subscription",
    targetId: groupId,
    targetName: existing.name,
  });

  return success({ id: groupId });
}
