import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, branchFilters, lineBranches, lineNodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

function notifyFilterChange(filterId: number) {
  const branches = db.select({ branchId: branchFilters.branchId }).from(branchFilters).where(eq(branchFilters.filterId, filterId)).all();
  const lineIds = new Set<number>();
  for (const b of branches) {
    const branch = db.select({ lineId: lineBranches.lineId }).from(lineBranches).where(eq(lineBranches.id, b.branchId)).get();
    if (branch) lineIds.add(branch.lineId);
  }
  for (const lineId of lineIds) {
    const entryNodes = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes).where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry"))).all();
    for (const n of entryNodes) {
      sseManager.notifyNodeConfigUpdate(n.nodeId);
    }
  }
}

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "无效的过滤规则 ID");

  const existing = db
    .select({ id: filters.id, name: filters.name, isEnabled: filters.isEnabled })
    .from(filters)
    .where(eq(filters.id, filterId))
    .get();
  if (!existing) return error("NOT_FOUND", "过滤规则不存在");

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
