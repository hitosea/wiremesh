import { db } from "@/lib/db";
import { lineTunnels } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";

type TunnelEndpoint = { fromNodeId: number; toNodeId: number };

export function pickPeerNodeIds(rows: TunnelEndpoint[], nodeId: number): number[] {
  const peers = new Set<number>();
  for (const row of rows) {
    if (row.fromNodeId !== nodeId) peers.add(row.fromNodeId);
    if (row.toNodeId !== nodeId) peers.add(row.toNodeId);
  }
  return Array.from(peers);
}

export function getPeerNodeIds(nodeId: number): number[] {
  const rows = db
    .select({ fromNodeId: lineTunnels.fromNodeId, toNodeId: lineTunnels.toNodeId })
    .from(lineTunnels)
    .where(or(eq(lineTunnels.fromNodeId, nodeId), eq(lineTunnels.toNodeId, nodeId)))
    .all();
  return pickPeerNodeIds(rows, nodeId);
}
