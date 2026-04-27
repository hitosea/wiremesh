import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, nodeStatus, devices } from "@/lib/db/schema";
import { eq, sql, and, gt, lt } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";
import { adminSseManager } from "@/lib/admin-sse-manager";
import { setNodeSnapshot } from "@/lib/tunnel-status-cache";
import { setSourceSnapshot } from "@/lib/node-latency-matrix";

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
    xray_transfers?: { uuid: string; upload_bytes: number; download_bytes: number }[];
    xray_connections?: { uuid: string; ips: { ip: string; last_seen: number }[] }[];
    socks5_transfers?: { line_id: number; upload_bytes: number; download_bytes: number }[];
    forward_upload?: number;
    forward_download?: number;
    agent_version?: string;
    xray_version?: string;
    xray_running?: boolean;
    tunnel_statuses?: { iface: string; peer_public_key: string; last_handshake: number; rx_bytes: number; tx_bytes: number; latency_ms?: number }[];
    peer_pings?: { node_id: number; latency_ms?: number }[];
  };

  const {
    is_online,
    latency,
    transfers = [],
    handshakes = [],
    xray_online_users = [],
    xray_transfers = [],
    xray_connections = [],
    socks5_transfers = [],
    forward_upload = 0,
    forward_download = 0,
    agent_version,
    xray_version,
  } = body;

  // Entry traffic spans three disjoint protocols (WG / Xray / SOCKS5);
  // missing any of them under-counts the dashboard "节点流量" entry column.
  let totalUpload = 0;
  let totalDownload = 0;
  for (const t of transfers) {
    totalUpload += t.upload_bytes ?? 0;
    totalDownload += t.download_bytes ?? 0;
  }
  for (const xt of xray_transfers) {
    totalUpload += xt.upload_bytes ?? 0;
    totalDownload += xt.download_bytes ?? 0;
  }
  for (const st of socks5_transfers) {
    totalUpload += st.upload_bytes ?? 0;
    totalDownload += st.download_bytes ?? 0;
  }

  db.insert(nodeStatus)
    .values({
      nodeId: node.id,
      isOnline: is_online,
      latency: latency ?? null,
      uploadBytes: totalUpload,
      downloadBytes: totalDownload,
      forwardUploadBytes: forward_upload,
      forwardDownloadBytes: forward_download,
    })
    .run();

  const newStatus = is_online ? "online" : "offline";
  db.update(nodes)
    .set({
      status: newStatus,
      ...(agent_version && { agentVersion: agent_version }),
      ...(xray_version && { xrayVersion: xray_version }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();

  adminSseManager.broadcast("node_status", {
    nodeId: node.id,
    status: newStatus,
    ...(agent_version && { agentVersion: agent_version }),
    ...(xray_version && { xrayVersion: xray_version }),
  });

  const transferMap = new Map<string, Transfer>();
  for (const t of transfers) {
    transferMap.set(t.peer_public_key, t);
  }

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
      adminSseManager.broadcast("device_status", {
        deviceId: device.id,
        lastHandshake: h.last_handshake,
      });
    }
  }

  const now = new Date().toISOString();

  for (const xt of xray_transfers) {
    db.update(devices)
      .set({
        uploadBytes: sql`${devices.uploadBytes} + ${xt.upload_bytes}`,
        downloadBytes: sql`${devices.downloadBytes} + ${xt.download_bytes}`,
        updatedAt: now,
      })
      .where(eq(devices.xrayUuid, xt.uuid))
      .run();
  }

  const connInfoByUuid = new Map<string, { count: number; ips: string }>();
  for (const c of xray_connections) {
    if (!c.ips) continue;
    connInfoByUuid.set(c.uuid, {
      count: c.ips.length,
      ips: JSON.stringify(c.ips),
    });
  }

  for (const uuid of xray_online_users) {
    const conn = connInfoByUuid.get(uuid);
    const count = conn?.count ?? 1;
    const updated = db
      .update(devices)
      .set({
        lastHandshake: now,
        connectionCount: count,
        activeIps: conn?.ips ?? null,
        updatedAt: now,
      })
      .where(eq(devices.xrayUuid, uuid))
      .returning({ id: devices.id })
      .get();
    if (updated) {
      adminSseManager.broadcast("device_status", {
        deviceId: updated.id,
        lastHandshake: now,
        connectionCount: count,
      });
    }
  }

  // Zero out connection_count for xray devices no node has reported on
  // recently. Must be time-windowed, not `NOT IN this_report.online_users`:
  // devices aren't node-scoped, so a poll from a node that doesn't host the
  // device would otherwise clobber another node's fresh write.
  const staleThreshold = new Date(Date.now() - 180_000).toISOString();
  const staleUpdated = db
    .update(devices)
    .set({ connectionCount: 0, activeIps: null, updatedAt: now })
    .where(and(
      eq(devices.protocol, "xray"),
      gt(devices.connectionCount, 0),
      lt(devices.updatedAt, staleThreshold),
    ))
    .returning({ id: devices.id })
    .all();
  for (const d of staleUpdated) {
    adminSseManager.broadcast("device_status", {
      deviceId: d.id,
      connectionCount: 0,
    });
  }

  // Older agents won't send tunnel_statuses; skip the cache write in that case.
  if (Array.isArray(body.tunnel_statuses)) {
    setNodeSnapshot(node.id, body.tunnel_statuses.map((t) => ({
      iface: t.iface,
      peerPublicKey: t.peer_public_key,
      lastHandshake: t.last_handshake,
      rxBytes: t.rx_bytes,
      txBytes: t.tx_bytes,
      latencyMs: typeof t.latency_ms === "number" ? t.latency_ms : null,
    })));
  }

  if (Array.isArray(body.peer_pings)) {
    setSourceSnapshot(node.id, body.peer_pings.map((p) => ({
      toNodeId: p.node_id,
      latencyMs: typeof p.latency_ms === "number" ? p.latency_ms : null,
    })));
  }

  return Response.json({ data: { ok: true } });
}
