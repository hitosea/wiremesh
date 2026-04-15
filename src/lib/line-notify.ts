import { db } from "@/lib/db";
import { lineNodes, nodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";

export function getLineNodeIds(lineId: number): number[] {
  return db
    .select({ nodeId: lineNodes.nodeId })
    .from(lineNodes)
    .where(eq(lineNodes.lineId, lineId))
    .all()
    .map((r) => r.nodeId);
}

export function notifyLineNodes(lineId: number): void {
  const nodeIds = getLineNodeIds(lineId);
  for (const nodeId of nodeIds) {
    db.update(nodes).set({ updatedAt: sql`(datetime('now'))` }).where(eq(nodes.id, nodeId)).run();
    sseManager.notifyNodeTunnelUpdate(nodeId);
  }
}
