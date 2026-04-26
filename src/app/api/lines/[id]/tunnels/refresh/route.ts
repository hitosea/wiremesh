import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineTunnels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sseManager } from "@/lib/sse-manager";
import { buildTunnelsView } from "@/lib/build-tunnels-view";

export const dynamic = "force-dynamic";

const REFRESH_WAIT_MS = 1500;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lineId = parseInt(id, 10);
  if (!Number.isFinite(lineId)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid line id" } }, { status: 400 });
  }

  const tunnels = db.select().from(lineTunnels).where(eq(lineTunnels.lineId, lineId)).all();
  const nodeIds = new Set<number>();
  for (const t of tunnels) {
    nodeIds.add(t.fromNodeId);
    nodeIds.add(t.toNodeId);
  }

  for (const nodeId of nodeIds) {
    sseManager.sendEvent(nodeId, "request_status_report", {});
  }

  await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));

  return Response.json(buildTunnelsView(lineId));
}
