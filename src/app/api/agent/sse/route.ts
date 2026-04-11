import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { authenticateAgent } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nodeId = node.id;

  const stream = new ReadableStream({
    start(controller) {
      sseManager.addConnection(nodeId, controller);

      // Check if this node is pending deletion
      const current = db
        .select({ pendingDelete: nodes.pendingDelete })
        .from(nodes)
        .where(eq(nodes.id, nodeId))
        .get();

      if (current?.pendingDelete) {
        // Node reconnected while pending delete — send delete event immediately
        const deleteMsg = `event: node_delete\ndata: {}\n\n`;
        controller.enqueue(new TextEncoder().encode(deleteMsg));
        return;
      }

      // Mark node online
      db.update(nodes)
        .set({ status: "online", errorMessage: null, updatedAt: new Date().toISOString() })
        .where(eq(nodes.id, nodeId))
        .run();

      // Send connected event
      const message = `event: connected\ndata: ${JSON.stringify({ nodeId })}\n\n`;
      controller.enqueue(new TextEncoder().encode(message));
    },
    cancel() {
      sseManager.removeConnection(nodeId);

      try {
        const current = db
          .select({ pendingDelete: nodes.pendingDelete })
          .from(nodes)
          .where(eq(nodes.id, nodeId))
          .get();

        if (current?.pendingDelete) {
          // Delay deletion to allow uninstall script to finish
          setTimeout(() => {
            db.delete(nodes).where(eq(nodes.id, nodeId)).run();
          }, 30000);
        } else {
          db.update(nodes)
            .set({ status: "offline", updatedAt: new Date().toISOString() })
            .where(eq(nodes.id, nodeId))
            .run();
        }
      } catch {
        // ignore
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
