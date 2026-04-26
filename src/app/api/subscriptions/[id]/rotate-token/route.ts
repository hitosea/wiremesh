import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subscriptionGroups } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { generateSubscriptionToken } from "@/lib/subscription/token";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const groupId = parseInt(id);
  if (isNaN(groupId)) return error("VALIDATION_ERROR", "validation.invalidId");

  const existing = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.id, groupId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.subscription");

  let token = generateSubscriptionToken();
  while (
    db.select({ id: subscriptionGroups.id })
      .from(subscriptionGroups)
      .where(eq(subscriptionGroups.token, token))
      .get()
  ) {
    token = generateSubscriptionToken();
  }

  db.update(subscriptionGroups)
    .set({ token, updatedAt: new Date().toISOString() })
    .where(eq(subscriptionGroups.id, groupId))
    .run();

  writeAuditLog({
    action: "update",
    targetType: "subscription",
    targetId: groupId,
    targetName: existing.name,
    detail: "rotate-token",
  });

  return success({ id: groupId, token });
}
