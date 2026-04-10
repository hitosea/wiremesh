import { db } from "@/lib/db";
import { devices, lineNodes, settings } from "@/lib/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";

export const DEFAULT_PROXY_PORT = 41443;

/** Read xray_default_port from settings, falling back to DEFAULT_PROXY_PORT. */
export function getXrayDefaultPort(): number {
  const row = db.select().from(settings).where(eq(settings.key, "xray_default_port")).get();
  return row?.value ? parseInt(row.value) || DEFAULT_PROXY_PORT : DEFAULT_PROXY_PORT;
}

/**
 * Compute the proxy inbound port for a given line and protocol on a node.
 * Xray and SOCKS5 share the same port pool starting from basePort.
 * Ports are allocated in line order; each (line, protocol) pair gets one port.
 * The iteration order must match GET /api/agent/config to stay in sync.
 */
export function getProxyPortForLine(
  nodeId: number,
  lineId: number,
  protocol: "xray" | "socks5",
  basePort: number
): number {
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  if (entryLineIds.length === 0) return basePort;

  const proxyDevices = db
    .select({ lineId: devices.lineId, protocol: devices.protocol })
    .from(devices)
    .where(
      and(
        inArray(devices.lineId, entryLineIds),
        or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))
      )
    )
    .all();

  const xrayLineIds = new Set(proxyDevices.filter((d) => d.protocol === "xray").map((d) => d.lineId));
  const socks5LineIds = new Set(proxyDevices.filter((d) => d.protocol === "socks5").map((d) => d.lineId));

  // Allocate all Xray ports first, then SOCKS5 ports, to avoid collisions.
  let port = basePort;
  for (const lid of entryLineIds) {
    if (xrayLineIds.has(lid)) {
      if (lid === lineId && protocol === "xray") return port;
      port++;
    }
  }
  for (const lid of entryLineIds) {
    if (socks5LineIds.has(lid)) {
      if (lid === lineId && protocol === "socks5") return port;
      port++;
    }
  }

  return basePort;
}

// Backwards compatibility aliases
export const DEFAULT_XRAY_PORT = DEFAULT_PROXY_PORT;
export function getXrayPortForLine(nodeId: number, lineId: number, basePort: number): number {
  return getProxyPortForLine(nodeId, lineId, "xray", basePort);
}
