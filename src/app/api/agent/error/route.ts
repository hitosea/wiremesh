import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } }, { status: 401 });
  }

  const body = await request.json() as { message: string };
  const { message } = body;

  db.update(nodes)
    .set({
      status: "error",
      errorMessage: message ?? "未知错误",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();

  return Response.json({ data: { ok: true } });
}
