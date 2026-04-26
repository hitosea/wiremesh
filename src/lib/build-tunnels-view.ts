import { db } from "@/lib/db";
import { lineTunnels, nodes } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getNodeSnapshot } from "@/lib/tunnel-status-cache";

export type TunnelView = {
  id: number;
  lineId: number;
  hopIndex: number;
  fromNodeId: number;
  fromNodeName: string;
  toNodeId: number;
  toNodeName: string;
  fromWgAddress: string;
  toWgAddress: string;
  fromWgPort: number;
  toWgPort: number;
  lastHandshake: number;
  rxBytes: number;
  txBytes: number;
  dataFromToNode: boolean;
  stale: boolean;
  fromNodeReachable: boolean;
  toNodeReachable: boolean;
};

export type TunnelsViewResponse = {
  lineId: number;
  lastReportedAt: number | null;
  tunnels: TunnelView[];
};

const STALE_THRESHOLD_S = 60;

export function buildTunnelsView(lineId: number): TunnelsViewResponse {
  const tunnels = db.select().from(lineTunnels).where(eq(lineTunnels.lineId, lineId)).all();
  if (tunnels.length === 0) {
    return { lineId, lastReportedAt: null, tunnels: [] };
  }

  const nodeIds = [...new Set(tunnels.flatMap((t) => [t.fromNodeId, t.toNodeId]))];
  const nodeRows = db.select({ id: nodes.id, name: nodes.name })
    .from(nodes).where(inArray(nodes.id, nodeIds)).all();
  const nodeName = new Map(nodeRows.map((n) => [n.id, n.name]));

  const now = Math.floor(Date.now() / 1000);

  let lastReportedAt: number | null = null;
  const view: TunnelView[] = tunnels.map((t) => {
    const ifaceName = `wm-tun${t.id}`;
    const fromSnap = getNodeSnapshot(t.fromNodeId);
    const toSnap = getNodeSnapshot(t.toNodeId);

    const fromReport = fromSnap?.tunnels.find((s) => s.iface === ifaceName) ?? null;
    const toReport = toSnap?.tunnels.find((s) => s.iface === ifaceName) ?? null;

    const fromHs = fromReport?.lastHandshake ?? 0;
    const toHs = toReport?.lastHandshake ?? 0;
    const lastHandshake = Math.max(fromHs, toHs);

    let rxBytes = 0, txBytes = 0, dataFromToNode = false;
    if (fromReport) {
      rxBytes = fromReport.rxBytes;
      txBytes = fromReport.txBytes;
    } else if (toReport) {
      rxBytes = toReport.txBytes;
      txBytes = toReport.rxBytes;
      dataFromToNode = true;
    }

    const reportedTimes = [fromSnap?.reportedAt, toSnap?.reportedAt].filter((x): x is number => typeof x === "number");
    if (reportedTimes.length > 0) {
      const newest = Math.max(...reportedTimes);
      if (lastReportedAt === null || newest > lastReportedAt) lastReportedAt = newest;
    }

    const stale = reportedTimes.length === 0 || (now - Math.max(...reportedTimes, 0)) > STALE_THRESHOLD_S;

    return {
      id: t.id,
      lineId: t.lineId,
      hopIndex: t.hopIndex,
      fromNodeId: t.fromNodeId,
      fromNodeName: nodeName.get(t.fromNodeId) ?? `node ${t.fromNodeId}`,
      toNodeId: t.toNodeId,
      toNodeName: nodeName.get(t.toNodeId) ?? `node ${t.toNodeId}`,
      fromWgAddress: t.fromWgAddress,
      toWgAddress: t.toWgAddress,
      fromWgPort: t.fromWgPort,
      toWgPort: t.toWgPort,
      lastHandshake,
      rxBytes,
      txBytes,
      dataFromToNode,
      stale,
      fromNodeReachable: fromSnap !== null,
      toNodeReachable: toSnap !== null,
    };
  });

  return { lineId, lastReportedAt, tunnels: view };
}
