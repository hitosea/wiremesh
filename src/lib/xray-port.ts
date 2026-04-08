import { db } from "@/lib/db";
import { devices, lineNodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Compute the Xray inbound port for a given line on a node.
 * Each line with Xray devices gets a dedicated port: basePort + lineIndex.
 * The iteration order must match GET /api/agent/config to stay in sync.
 */
export function getXrayPortForLine(nodeId: number, lineId: number, basePort: number): number {
  const entryLineIds = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.hopOrder, 0)))
    .all()
    .map((r) => r.lineId);

  let index = 0;
  for (const lid of entryLineIds) {
    const hasXrayDevice = db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.lineId, lid), eq(devices.protocol, "xray")))
      .get();
    if (!hasXrayDevice) continue;
    if (lid === lineId) return basePort + index;
    index++;
  }

  return basePort;
}
