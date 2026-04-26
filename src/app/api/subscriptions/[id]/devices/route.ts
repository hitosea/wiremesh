import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subscriptionGroups, subscriptionGroupDevices, devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const groupId = parseInt(id);
  if (isNaN(groupId)) return error("VALIDATION_ERROR", "validation.invalidId");

  const body = await request.json();
  const { deviceIds } = body as { deviceIds?: number[] };
  if (!Array.isArray(deviceIds)) {
    return error("VALIDATION_ERROR", "validation.deviceIdsRequired");
  }

  const group = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.id, groupId))
    .get();
  if (!group) return error("NOT_FOUND", "notFound.subscription");

  const uniqueIds = Array.from(new Set(deviceIds.filter((n) => Number.isInteger(n))));

  const validIds = uniqueIds.length === 0
    ? []
    : db
        .select({ id: devices.id })
        .from(devices)
        .where(inArray(devices.id, uniqueIds))
        .all()
        .map((r) => r.id);

  // Replace-all semantics: clear then insert. Wrapped in a transaction so
  // a failure mid-way leaves the existing membership intact.
  db.transaction((tx) => {
    tx.delete(subscriptionGroupDevices)
      .where(eq(subscriptionGroupDevices.groupId, groupId))
      .run();
    for (const deviceId of validIds) {
      tx.insert(subscriptionGroupDevices)
        .values({ groupId, deviceId })
        .run();
    }
  });

  writeAuditLog({
    action: "update",
    targetType: "subscription",
    targetId: groupId,
    targetName: group.name,
    detail: `devices=${validIds.length}`,
  });

  return success({ groupId, deviceIds: validIds });
}
