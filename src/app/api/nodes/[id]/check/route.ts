import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { success, error } from "@/lib/api-response";
import { sseManager } from "@/lib/sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const node = db
    .select({ id: nodes.id, status: nodes.status })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();
  if (!node) return error("NOT_FOUND", "notFound.node");

  const isConnected = sseManager.isConnected(nodeId);

  // If node claims to be online but has no active SSE connection, mark it offline
  if (!isConnected && node.status === "online") {
    db.update(nodes)
      .set({ status: "offline", updatedAt: new Date().toISOString() })
      .where(eq(nodes.id, nodeId))
      .run();

    return success({ nodeId, status: "offline", sseConnected: false, updated: true });
  }

  return success({ nodeId, status: isConnected ? "online" : node.status, sseConnected: isConnected, updated: false });
}
