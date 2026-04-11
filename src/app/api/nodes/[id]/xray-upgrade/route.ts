import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { success, error } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const node = db.select({ id: nodes.id, name: nodes.name }).from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "notFound.node");

  const sent = sseManager.sendEvent(nodeId, "xray_upgrade", {});
  if (!sent) {
    return error("CONFLICT", "nodes.upgradeOffline");
  }

  db.update(nodes)
    .set({ xrayUpgradeTriggeredAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(nodes.id, nodeId))
    .run();

  return success({ message: "nodes.xrayUpgradeTriggered" });
}
