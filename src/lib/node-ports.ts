import { db } from "@/lib/db";
import { lineTunnels, lineNodes, devices } from "@/lib/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";
import { getXrayDefaultPort } from "@/lib/proxy-port";

export type NodePorts = {
  wg: number;
  xray: number[];
  tunnels: number[];
  socks5: number[];
};

/**
 * Compute all ports used by a single node.
 */
export function getNodePorts(nodeId: number, wgPort: number, xrayPort: number | null): NodePorts {
  const xrayDefaultPort = getXrayDefaultPort();
  const basePort = xrayPort ?? xrayDefaultPort;

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

  // Find xray/socks5 devices on those lines
  const proxyDeviceRows = entryLineIds.length > 0
    ? db
        .select({ lineId: devices.lineId, protocol: devices.protocol })
        .from(devices)
        .where(
          and(
            inArray(devices.lineId, entryLineIds),
            or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))
          )
        )
        .all()
    : [];

  const xrayLineIds = new Set(proxyDeviceRows.filter((d) => d.protocol === "xray" && d.lineId != null).map((d) => d.lineId!));
  const socks5LineIds = new Set(proxyDeviceRows.filter((d) => d.protocol === "socks5" && d.lineId != null).map((d) => d.lineId!));

  // Allocate ports: Xray first, then SOCKS5
  let port = basePort;
  const xrayPorts: number[] = [];
  for (const lid of entryLineIds) {
    if (xrayLineIds.has(lid)) {
      xrayPorts.push(port++);
    }
  }
  const socks5Ports: number[] = [];
  for (const lid of entryLineIds) {
    if (socks5LineIds.has(lid)) {
      socks5Ports.push(port++);
    }
  }

  return {
    wg: wgPort,
    xray: xrayPorts,
    tunnels: [...tunnelPorts].sort((a, b) => a - b),
    socks5: socks5Ports,
  };
}
