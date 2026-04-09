import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, branchFilters, lineBranches, lineNodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) return error("VALIDATION_ERROR", "validation.invalidRuleId");

  const filter = db
    .select()
    .from(filters)
    .where(eq(filters.id, filterId))
    .get();
  if (!filter) return error("NOT_FOUND", "notFound.rule");
  if (!filter.sourceUrl) return error("VALIDATION_ERROR", "validation.noSourceUrl");

  // Find entry nodes associated with this filter and notify them
  const branches = db
    .select({ branchId: branchFilters.branchId })
    .from(branchFilters)
    .where(eq(branchFilters.filterId, filterId))
    .all();

  const notifiedNodes = new Set<number>();
  for (const b of branches) {
    const branch = db
      .select({ lineId: lineBranches.lineId })
      .from(lineBranches)
      .where(eq(lineBranches.id, b.branchId))
      .get();
    if (!branch) continue;

    const entryNodes = db
      .select({ nodeId: lineNodes.nodeId })
      .from(lineNodes)
      .where(and(eq(lineNodes.lineId, branch.lineId), eq(lineNodes.role, "entry")))
      .all();

    for (const n of entryNodes) {
      if (!notifiedNodes.has(n.nodeId)) {
        sseManager.notifyNodeConfigUpdate(n.nodeId);
        notifiedNodes.add(n.nodeId);
      }
    }
  }

  return success({ message: "同步通知已发送", notifiedNodes: notifiedNodes.size });
}
