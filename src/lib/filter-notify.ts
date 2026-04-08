import { db } from "@/lib/db";
import { branchFilters, lineBranches, lineNodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";

export function notifyFilterChange(filterId: number) {
  const branches = db
    .select({ branchId: branchFilters.branchId })
    .from(branchFilters)
    .where(eq(branchFilters.filterId, filterId))
    .all();

  const lineIds = new Set<number>();
  for (const b of branches) {
    const branch = db
      .select({ lineId: lineBranches.lineId })
      .from(lineBranches)
      .where(eq(lineBranches.id, b.branchId))
      .get();
    if (branch) lineIds.add(branch.lineId);
  }

  for (const lineId of lineIds) {
    const entryNodes = db
      .select({ nodeId: lineNodes.nodeId })
      .from(lineNodes)
      .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry")))
      .all();
    for (const n of entryNodes) {
      sseManager.notifyNodeConfigUpdate(n.nodeId);
    }
  }
}
