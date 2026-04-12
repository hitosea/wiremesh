import { db } from "@/lib/db";
import { lineTunnels, lineNodes, lines } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export type NodePorts = {
  wg: number;
  xray: number[];
  tunnels: number[];
  socks5: number[];
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

  // Entry lines for this node — read persisted proxy ports
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  const xrayPorts: number[] = [];
  const socks5Ports: number[] = [];

  if (entryLineIds.length > 0) {
    const lineRows = db
      .select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
      .from(lines)
      .where(inArray(lines.id, entryLineIds))
      .all();
    for (const row of lineRows) {
      if (row.xrayPort !== null) xrayPorts.push(row.xrayPort);
      if (row.socks5Port !== null) socks5Ports.push(row.socks5Port);
    }
  }

  return {
    wg: wgPort,
    xray: xrayPorts.sort((a, b) => a - b),
    tunnels: [...tunnelPorts].sort((a, b) => a - b),
    socks5: socks5Ports.sort((a, b) => a - b),
  };
}
