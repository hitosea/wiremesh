import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subscriptionGroups, subscriptionGroupDevices, devices } from "@/lib/db/schema";
import { created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { like, count, eq, inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { generateSubscriptionToken } from "@/lib/subscription/token";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");

  const where = search ? like(subscriptionGroups.name, `%${search}%`) : undefined;
  const total =
    db.select({ count: count() }).from(subscriptionGroups).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(subscriptionGroups)
    .where(where)
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  const enriched = rows.map((row) => {
    const deviceCount =
      db
        .select({ count: count() })
        .from(subscriptionGroupDevices)
        .where(eq(subscriptionGroupDevices.groupId, row.id))
        .get()?.count ?? 0;
    return { ...row, deviceCount };
  });

  return paginated(enriched, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, remark, deviceIds } = body as {
    name?: string;
    remark?: string;
    deviceIds?: number[];
  };

  if (!name || !name.trim()) {
    return error("VALIDATION_ERROR", "validation.nameRequired");
  }

  const existingByName = db
    .select({ id: subscriptionGroups.id })
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.name, name.trim()))
    .get();
  if (existingByName) {
    return error("CONFLICT", "subscriptions.errors.nameTaken");
  }

  let token = generateSubscriptionToken();
  // Token collisions on 256-bit space are vanishingly unlikely; loop only as defensive belt-and-braces.
  while (db.select({ id: subscriptionGroups.id }).from(subscriptionGroups).where(eq(subscriptionGroups.token, token)).get()) {
    token = generateSubscriptionToken();
  }

  const inserted = db
    .insert(subscriptionGroups)
    .values({
      name: name.trim(),
      token,
      remark: remark?.trim() || null,
    })
    .returning()
    .get();

  if (Array.isArray(deviceIds) && deviceIds.length > 0) {
    const validIds = db
      .select({ id: devices.id })
      .from(devices)
      .where(inArray(devices.id, deviceIds))
      .all()
      .map((r) => r.id);
    for (const deviceId of validIds) {
      db.insert(subscriptionGroupDevices)
        .values({ groupId: inserted.id, deviceId })
        .run();
    }
  }

  writeAuditLog({
    action: "create",
    targetType: "subscription",
    targetId: inserted.id,
    targetName: inserted.name,
  });

  return created(inserted);
}
