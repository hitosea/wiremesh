import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { success, error } from "@/lib/api-response";
import { adminSseManager } from "@/lib/admin-sse-manager";

export async function POST(request: NextRequest) {
  const body = await request.json() as { nodeIds: number[]; type: "agent" | "xray" };
  const { nodeIds, type } = body;

  if (!nodeIds?.length) return error("VALIDATION_ERROR", "validation.nodeIdsRequired");

  const event = type === "xray" ? "xray_upgrade" : "upgrade";
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 3000;

  let sent = 0;
  let offline = 0;

  for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
    const batch = nodeIds.slice(i, i + BATCH_SIZE);
    for (const nodeId of batch) {
      if (sseManager.sendEvent(nodeId, event, {})) {
        const now = new Date().toISOString();
        const field = type === "xray"
          ? { xrayUpgradeTriggeredAt: now }
          : { upgradeTriggeredAt: now };
        db.update(nodes)
          .set({ ...field, updatedAt: now })
          .where(eq(nodes.id, nodeId))
          .run();
        adminSseManager.broadcast("node_status", { nodeId, ...field });
        sent++;
      } else {
        offline++;
      }
    }
    if (i + BATCH_SIZE < nodeIds.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return success({ sent, offline, total: nodeIds.length });
}
