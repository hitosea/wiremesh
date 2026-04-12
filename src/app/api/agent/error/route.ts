import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";
import { adminSseManager } from "@/lib/admin-sse-manager";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } }, { status: 401 });
  }

  const body = await request.json() as { message: string };
  const { message } = body;

  const errorMsg = message ?? "未知错误";
  db.update(nodes)
    .set({
      status: "error",
      errorMessage: errorMsg,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();

  adminSseManager.broadcast("node_status", {
    nodeId: node.id,
    status: "error",
    errorMessage: errorMsg,
  });

  return Response.json({ data: { ok: true } });
}
