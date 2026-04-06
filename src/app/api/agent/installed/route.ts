import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } }, { status: 401 });
  }

  db.update(nodes)
    .set({
      status: "online",
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();

  writeAuditLog({
    action: "update",
    targetType: "node",
    targetId: node.id,
    targetName: node.name,
    detail: "Agent 安装完成回调",
  });

  return Response.json({ data: { ok: true } });
}
