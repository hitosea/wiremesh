import { NextRequest } from "next/server";
import { buildTunnelsView } from "@/lib/build-tunnels-view";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lineId = parseInt(id, 10);
  if (!Number.isFinite(lineId)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid line id" } }, { status: 400 });
  }
  return Response.json(buildTunnelsView(lineId));
}
