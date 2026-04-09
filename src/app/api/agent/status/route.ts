import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, nodeStatus, devices } from "@/lib/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
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
    xray_online_users?: string[];
  };

  const { is_online, latency, transfers = [], handshakes = [], xray_online_users = [] } = body;

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

  // Build a map of peer transfers for quick lookup
  const transferMap = new Map<string, Transfer>();
  for (const t of transfers) {
    transferMap.set(t.peer_public_key, t);
  }

  // Update device last_handshake and accumulate traffic deltas
  // Device online/offline status is computed from lastHandshake at query time
  for (const h of handshakes) {
    const device = db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.wgPublicKey, h.peer_public_key))
      .get();
    if (device) {
      const t = transferMap.get(h.peer_public_key);
      db.update(devices)
        .set({
          lastHandshake: h.last_handshake,
          ...(t && {
            uploadBytes: sql`${devices.uploadBytes} + ${t.upload_bytes}`,
            downloadBytes: sql`${devices.downloadBytes} + ${t.download_bytes}`,
          }),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(devices.id, device.id))
        .run();
    }
  }

  // Update online status for Xray-protocol devices
  if (xray_online_users.length > 0) {
    const now = new Date().toISOString();
    db.update(devices)
      .set({ lastHandshake: now, updatedAt: now })
      .where(inArray(devices.xrayUuid, xray_online_users))
      .run();
  }

  return Response.json({ data: { ok: true } });
}
