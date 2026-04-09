import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyFilterChange } from "@/lib/filter-notify";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "validation.invalidFilterId");

  const existing = db
    .select({ id: filters.id, name: filters.name, isEnabled: filters.isEnabled })
    .from(filters)
    .where(eq(filters.id, filterId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.filter");

  const updated = db
    .update(filters)
    .set({
      isEnabled: !existing.isEnabled,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(filters.id, filterId))
    .returning()
    .get();

  writeAuditLog({
    action: "update",
    targetType: "filter",
    targetId: filterId,
    targetName: existing.name,
    detail: `isEnabled=${updated.isEnabled}`,
  });

  notifyFilterChange(filterId);

  return success(updated);
}
