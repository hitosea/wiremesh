import { db } from "@/lib/db";
import { devices, lineNodes } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export const DEFAULT_XRAY_PORT = 41443;

/**
 * Compute the Xray inbound port for a given line on a node.
 * Each line with Xray devices gets a dedicated port starting from basePort.
 * The iteration order must match GET /api/agent/config to stay in sync.
 */
export function getXrayPortForLine(nodeId: number, lineId: number, basePort: number): number {
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  const xrayLineIds = new Set(
    db.select({ lineId: devices.lineId })
      .from(devices)
      .where(and(inArray(devices.lineId, entryLineIds), eq(devices.protocol, "xray")))
      .all()
      .map((r) => r.lineId)
  );

  let port = basePort;
  for (const lid of entryLineIds) {
    if (!xrayLineIds.has(lid)) continue;
    if (lid === lineId) return port;
    port++;
  }

  return basePort;
}
