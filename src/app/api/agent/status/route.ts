import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, nodeStatus, devices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";

type Transfer = { peer_public_key: string; upload_bytes: number; download_bytes: number };
type Handshake = { peer_public_key: string; last_handshake: string };

export async function POST(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } }, { status: 401 });
  }

  const body = await request.json() as {
    is_online: boolean;
    latency?: number;
    transfers?: Transfer[];
    handshakes?: Handshake[];
  };

  const { is_online, latency, transfers = [], handshakes = [] } = body;

  // Sum upload/download bytes from all transfers
  let totalUpload = 0;
  let totalDownload = 0;
  for (const t of transfers) {
    totalUpload += t.upload_bytes ?? 0;
    totalDownload += t.download_bytes ?? 0;
  }

  // Insert node_status record
  db.insert(nodeStatus)
    .values({
      nodeId: node.id,
      isOnline: is_online,
      latency: latency ?? null,
      uploadBytes: totalUpload,
      downloadBytes: totalDownload,
    })
    .run();

  // Update node status
  db.update(nodes)
    .set({
      status: is_online ? "online" : "offline",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();

  // Update device last_handshake for matching handshakes
  // Device online/offline status is computed from lastHandshake at query time
  for (const h of handshakes) {
    const device = db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.wgPublicKey, h.peer_public_key))
      .get();
    if (device) {
      db.update(devices)
        .set({
          lastHandshake: h.last_handshake,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(devices.id, device.id))
        .run();
    }
  }

  return Response.json({ data: { ok: true } });
}
