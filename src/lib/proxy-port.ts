import { db } from "@/lib/db";
import { devices, lineNodes, lines, nodes, settings } from "@/lib/db/schema";
import { eq, and, or, inArray, isNotNull, isNull } from "drizzle-orm";

export const DEFAULT_PROXY_PORT = 41443;

/** Read xray_default_port from settings, falling back to DEFAULT_PROXY_PORT. */
export function getXrayDefaultPort(): number {
  const row = db.select().from(settings).where(eq(settings.key, "xray_default_port")).get();
  return row?.value ? parseInt(row.value) || DEFAULT_PROXY_PORT : DEFAULT_PROXY_PORT;
}

/**
 * Allocate the next free proxy port for a line on its entry node.
 * Scans all occupied xray_port and socks5_port values on that node,
 * then returns the first unused port starting from basePort.
 */
export function allocateProxyPort(entryNodeId: number, basePort: number): number {
  // Find all lines where this node is the entry (hopOrder=0)
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, entryNodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  if (entryLineIds.length === 0) return basePort;

  // Collect all occupied ports (both xray and socks5) on these lines
  const occupiedRows = db
    .select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
    .from(lines)
    .where(inArray(lines.id, entryLineIds))
    .all();

  const occupied = new Set<number>();
  for (const row of occupiedRows) {
    if (row.xrayPort !== null) occupied.add(row.xrayPort);
    if (row.socks5Port !== null) occupied.add(row.socks5Port);
  }

  // Find first free port
  for (let port = basePort; port < basePort + 100; port++) {
    if (!occupied.has(port)) return port;
  }

  return basePort;
}

/**
 * One-time backfill: assign ports to existing lines that have xray/socks5
 * devices but no persisted port yet. Idempotent — skips lines that already have ports.
 */
export function backfillProxyPorts(): void {
  // Early exit: nothing to backfill if all lines already have ports
  const needsBackfill = db
    .select({ id: lines.id })
    .from(lines)
    .where(and(
      inArray(lines.id,
        db.select({ lineId: devices.lineId }).from(devices)
          .where(and(isNotNull(devices.lineId), or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))))
      ),
      or(isNull(lines.xrayPort), isNull(lines.socks5Port))
    ))
    .get();
  if (!needsBackfill) return;

  // Batch-fetch all data needed for backfill
  const allLineRows = db.select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port }).from(lines).all();
  const lineMap = new Map(allLineRows.map((r) => [r.id, r]));

  const allEntryNodes = db.select({ lineId: lineNodes.lineId, nodeId: lineNodes.nodeId }).from(lineNodes).where(eq(lineNodes.hopOrder, 0)).all();
  const entryNodeMap = new Map(allEntryNodes.map((r) => [r.lineId, r.nodeId]));

  const allNodes = db.select({ id: nodes.id, xrayPort: nodes.xrayPort }).from(nodes).all();
  const nodeMap = new Map(allNodes.map((r) => [r.id, r.xrayPort]));

  const defaultPort = getXrayDefaultPort();

  for (const protocol of ["xray", "socks5"] as const) {
    const portField = protocol === "xray" ? "xrayPort" : "socks5Port";

    const lineIds = [...new Set(
      db.select({ lineId: devices.lineId }).from(devices)
        .where(and(eq(devices.protocol, protocol), isNotNull(devices.lineId)))
        .all().map((r) => r.lineId!)
    )];

    for (const lineId of lineIds) {
      const line = lineMap.get(lineId);
      if (!line || line[portField] !== null) continue;

      const entryNodeId = entryNodeMap.get(lineId);
      if (entryNodeId === undefined) continue;

      const basePort = nodeMap.get(entryNodeId) ?? defaultPort;
      const port = allocateProxyPort(entryNodeId, basePort);
      db.update(lines).set({ [portField]: port }).where(eq(lines.id, lineId)).run();
      line[portField] = port; // keep lineMap in sync for subsequent allocateProxyPort calls
    }
  }
}
