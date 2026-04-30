import { db } from "@/lib/db";
import { lineTunnels, lineNodes, lineProtocols } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { DeviceProtocol } from "@/lib/protocols";

export type PortGroup = {
  protocol: DeviceProtocol;
  ports: { lineId: number; port: number }[];
};

export type NodePorts = {
  wg: number;
  tunnels: number[];
  groups: PortGroup[];
};

/**
 * Compute all ports used by a single node.
 */
export function getNodePorts(nodeId: number, wgPort: number): NodePorts {
  // Tunnel ports
  const tunnelPorts = new Set<number>();
  const fromRows = db
    .select({ port: lineTunnels.fromWgPort })
    .from(lineTunnels)
    .where(eq(lineTunnels.fromNodeId, nodeId))
    .all();
  const toRows = db
    .select({ port: lineTunnels.toWgPort })
    .from(lineTunnels)
    .where(eq(lineTunnels.toNodeId, nodeId))
    .all();
  for (const r of fromRows) tunnelPorts.add(r.port);
  for (const r of toRows) tunnelPorts.add(r.port);

  // Entry lines for this node
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  // Build per-protocol port groups from line_protocols
  const byProtocol = new Map<string, { lineId: number; port: number }[]>();
  if (entryLineIds.length > 0) {
    const protocolRows = db
      .select({
        protocol: lineProtocols.protocol,
        lineId: lineProtocols.lineId,
        port: lineProtocols.port,
      })
      .from(lineProtocols)
      .where(inArray(lineProtocols.lineId, entryLineIds))
      .all();

    for (const r of protocolRows) {
      if (r.port == null) continue; // wireguard rows have null ports
      const list = byProtocol.get(r.protocol) ?? [];
      list.push({ lineId: r.lineId, port: r.port });
      byProtocol.set(r.protocol, list);
    }
  }

  const groups: PortGroup[] = Array.from(byProtocol.entries()).map(
    ([protocol, ports]) => ({
      protocol: protocol as DeviceProtocol,
      ports: ports.sort((a, b) => a.port - b.port),
    })
  );

  return {
    wg: wgPort,
    tunnels: [...tunnelPorts].sort((a, b) => a - b),
    groups,
  };
}
