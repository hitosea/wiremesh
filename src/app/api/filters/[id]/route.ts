import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, branchFilters, lineBranches, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyFilterChange } from "@/lib/filter-notify";

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

  // Fetch associated branches grouped by line
  const associatedBranches = db
    .select({
      branchId: branchFilters.branchId,
      branchName: lineBranches.name,
      lineId: lineBranches.lineId,
      lineName: lines.name,
    })
    .from(branchFilters)
    .innerJoin(lineBranches, eq(branchFilters.branchId, lineBranches.id))
    .innerJoin(lines, eq(lineBranches.lineId, lines.id))
    .where(eq(branchFilters.filterId, filterId))
    .all();

  return success({ ...filter, branches: associatedBranches });
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
  const { name, rules, domainRules, mode, branchIds, sourceUrl, tags, remark } = body;

  if (mode && !["whitelist", "blacklist"].includes(mode)) {
    return error("VALIDATION_ERROR", "mode 必须是 whitelist 或 blacklist");
  }

  const updateData: Partial<typeof filters.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (rules !== undefined) updateData.rules = rules ?? "";
  if (domainRules !== undefined) updateData.domainRules = domainRules ?? "";
  if (sourceUrl !== undefined) updateData.sourceUrl = sourceUrl;
  if (mode !== undefined) updateData.mode = mode;
  if (tags !== undefined) updateData.tags = tags;
  if (remark !== undefined) updateData.remark = remark;

  const updated = db
    .update(filters)
    .set(updateData)
    .where(eq(filters.id, filterId))
    .returning()
    .get();

  // Update branch associations if provided
  if (branchIds !== undefined) {
    db.delete(branchFilters).where(eq(branchFilters.filterId, filterId)).run();
    if (Array.isArray(branchIds)) {
      for (const branchId of branchIds) {
        db.insert(branchFilters)
          .values({ branchId, filterId })
          .run();
      }
    }
  }

  writeAuditLog({
    action: "update",
    targetType: "filter",
    targetId: filterId,
    targetName: existing.name,
  });

  notifyFilterChange(filterId);

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

  // Notify before deleting so branchFilters still exist for lookup
  notifyFilterChange(filterId);

  db.delete(filters).where(eq(filters.id, filterId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "filter",
    targetId: filterId,
    targetName: existing.name,
  });

  return success({ message: "过滤规则已删除" });
}
