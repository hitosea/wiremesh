import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineTunnels, nodes, settings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { allocateTunnelPort, parseTunnelPortBlacklist } from "@/lib/ip-allocator";
import { generateKeyPair } from "@/lib/wireguard";
import { encrypt } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tunnelId = parseInt(id, 10);
  if (!Number.isFinite(tunnelId)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid tunnel id" } }, { status: 400 });
  }

  const tunnel = db.select().from(lineTunnels).where(eq(lineTunnels.id, tunnelId)).get();
  if (!tunnel) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Tunnel not found" } }, { status: 404 });
  }

  const fromNode = db.select().from(nodes).where(eq(nodes.id, tunnel.fromNodeId)).get();
  const toNode = db.select().from(nodes).where(eq(nodes.id, tunnel.toNodeId)).get();
  if (!fromNode || !toNode) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Node not found" } }, { status: 404 });
  }

  // The user's intent in calling reallocate is "this port pair is bad" —
  // auto-add it to each end's blacklist before picking new ports.
  const fromBL = new Set(parseTunnelPortBlacklist(fromNode.tunnelPortBlacklist));
  const toBL = new Set(parseTunnelPortBlacklist(toNode.tunnelPortBlacklist));
  const oldFromPort = tunnel.fromWgPort;
  const oldToPort = tunnel.toWgPort;
  fromBL.add(oldFromPort);
  toBL.add(oldToPort);

  const newFromBLCsv = [...fromBL].sort((a, b) => a - b).join(",");
  const newToBLCsv = [...toBL].sort((a, b) => a - b).join(",");

  const startRow = db.select().from(settings).where(eq(settings.key, "tunnel_port_start")).get();
  const tunnelPortStart = parseInt(startRow?.value ?? "41830", 10);

  const allTunnels = db
    .select({ from: lineTunnels.fromWgPort, to: lineTunnels.toWgPort, id: lineTunnels.id })
    .from(lineTunnels)
    .all();
  const usedPorts = allTunnels
    .filter((t) => t.id !== tunnelId)
    .flatMap((t) => [t.from, t.to]);

  const combinedBL = new Set([...fromBL, ...toBL]);
  const newFromPort = allocateTunnelPort(usedPorts, tunnelPortStart, combinedBL);
  usedPorts.push(newFromPort);
  const newToPort = allocateTunnelPort(usedPorts, tunnelPortStart, combinedBL);

  const fromKp = generateKeyPair();
  const toKp = generateKeyPair();

  // Wrap all writes in a transaction so a mid-sequence crash can't leave the
  // tunnel keys/ports and node blacklists in an inconsistent state.
  db.transaction((tx) => {
    tx.update(lineTunnels)
      .set({
        fromWgPort: newFromPort,
        toWgPort: newToPort,
        fromWgPrivateKey: encrypt(fromKp.privateKey),
        fromWgPublicKey: fromKp.publicKey,
        toWgPrivateKey: encrypt(toKp.privateKey),
        toWgPublicKey: toKp.publicKey,
      })
      .where(eq(lineTunnels.id, tunnelId))
      .run();

    tx.update(nodes)
      .set({ tunnelPortBlacklist: newFromBLCsv, updatedAt: sql`(datetime('now'))` })
      .where(eq(nodes.id, tunnel.fromNodeId))
      .run();

    tx.update(nodes)
      .set({ tunnelPortBlacklist: newToBLCsv, updatedAt: sql`(datetime('now'))` })
      .where(eq(nodes.id, tunnel.toNodeId))
      .run();
  });

  sseManager.sendEvent(tunnel.fromNodeId, "tunnel_update", {});
  sseManager.sendEvent(tunnel.toNodeId, "tunnel_update", {});

  // writeAuditLog's union doesn't have "reallocate_tunnel" / "line_tunnel";
  // the detail string carries the full semantics.
  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: tunnelId,
    targetName: `tunnel#${tunnelId}`,
    detail: `reallocate: old=${oldFromPort}/${oldToPort} new=${newFromPort}/${newToPort}; auto-blacklisted on nodes ${tunnel.fromNodeId},${tunnel.toNodeId}`,
  });

  return Response.json({
    ok: true,
    tunnelId,
    oldPorts: { from: oldFromPort, to: oldToPort },
    newPorts: { from: newFromPort, to: newToPort },
    blacklistAdded: { fromNodeId: tunnel.fromNodeId, toNodeId: tunnel.toNodeId },
  });
}
