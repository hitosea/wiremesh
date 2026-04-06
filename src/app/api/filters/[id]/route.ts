import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, lineFilters, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "无效的过滤规则 ID");

  const filter = db
    .select()
    .from(filters)
    .where(eq(filters.id, filterId))
    .get();

  if (!filter) return error("NOT_FOUND", "过滤规则不存在");

  // Fetch associated lines
  const associatedLines = db
    .select({
      lineId: lineFilters.lineId,
      lineName: lines.name,
    })
    .from(lineFilters)
    .innerJoin(lines, eq(lineFilters.lineId, lines.id))
    .where(eq(lineFilters.filterId, filterId))
    .all();

  return success({ ...filter, lines: associatedLines });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "无效的过滤规则 ID");

  const existing = db
    .select({ id: filters.id, name: filters.name })
    .from(filters)
    .where(eq(filters.id, filterId))
    .get();
  if (!existing) return error("NOT_FOUND", "过滤规则不存在");

  const body = await request.json();
  const { name, rules, mode, lineIds, tags, remark } = body;

  if (mode && !["whitelist", "blacklist"].includes(mode)) {
    return error("VALIDATION_ERROR", "mode 必须是 whitelist 或 blacklist");
  }

  const updateData: Partial<typeof filters.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (rules !== undefined) updateData.rules = rules;
  if (mode !== undefined) updateData.mode = mode;
  if (tags !== undefined) updateData.tags = tags;
  if (remark !== undefined) updateData.remark = remark;

  const updated = db
    .update(filters)
    .set(updateData)
    .where(eq(filters.id, filterId))
    .returning()
    .get();

  // Update line associations if provided
  if (lineIds !== undefined && Array.isArray(lineIds)) {
    db.delete(lineFilters).where(eq(lineFilters.filterId, filterId)).run();
    for (const lineId of lineIds) {
      db.insert(lineFilters)
        .values({ lineId, filterId })
        .run();
    }
  }

  writeAuditLog({
    action: "update",
    targetType: "filter",
    targetId: filterId,
    targetName: existing.name,
  });

  return success(updated);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "无效的过滤规则 ID");

  const existing = db
    .select({ id: filters.id, name: filters.name })
    .from(filters)
    .where(eq(filters.id, filterId))
    .get();
  if (!existing) return error("NOT_FOUND", "过滤规则不存在");

  db.delete(filters).where(eq(filters.id, filterId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "filter",
    targetId: filterId,
    targetName: existing.name,
  });

  return success({ message: "过滤规则已删除" });
}
