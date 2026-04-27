// Process-local in-memory cache of node-to-node ping results reported by agents.
// Each agent measures RTT to every other node's public host and includes a
// per-peer ping list in its status report; we keep the latest snapshot per
// source node and expose a bidirectional best-of lookup for the UI.
//
// Same single-process assumption as tunnel-status-cache: not shared across
// replicas. Replace with a shared store if we ever scale out.

import { pairKey, type LatencyMatrix } from "@/lib/latency-pair";

export type PeerPing = {
  toNodeId: number;
  latencyMs: number | null; // null = unreachable at last measurement
};

export type SourceSnapshot = {
  reportedAt: number; // unix seconds
  pings: PeerPing[];
};

type CacheStore = Map<number, SourceSnapshot>;

const CACHE_VERSION = 1;
const globalForCache = globalThis as typeof globalThis & {
  nodeLatencyMatrixCache?: CacheStore;
  nodeLatencyMatrixCacheVersion?: number;
};

if (
  !globalForCache.nodeLatencyMatrixCache ||
  globalForCache.nodeLatencyMatrixCacheVersion !== CACHE_VERSION
) {
  globalForCache.nodeLatencyMatrixCache = new Map();
  globalForCache.nodeLatencyMatrixCacheVersion = CACHE_VERSION;
}

const cache = globalForCache.nodeLatencyMatrixCache;

export function setSourceSnapshot(sourceNodeId: number, pings: PeerPing[]): void {
  cache.set(sourceNodeId, {
    reportedAt: Math.floor(Date.now() / 1000),
    pings,
  });
}

export function clearAllSnapshots(): void {
  cache.clear();
}

// deleteSource purges a node's row and any other source's pings *to* that node.
// Called when a node is deleted so the matrix stops returning RTTs for it.
export function deleteSource(nodeId: number): void {
  cache.delete(nodeId);
  for (const snap of cache.values()) {
    snap.pings = snap.pings.filter((p) => p.toNodeId !== nodeId);
  }
}

export function buildLatencyMatrix(): LatencyMatrix {
  const best = new Map<string, number>();
  let lastReportedAt: number | null = null;
  for (const [src, snap] of cache) {
    if (lastReportedAt === null || snap.reportedAt > lastReportedAt) {
      lastReportedAt = snap.reportedAt;
    }
    for (const p of snap.pings) {
      if (p.latencyMs === null) continue;
      const key = pairKey(src, p.toNodeId);
      const prev = best.get(key);
      if (prev === undefined || p.latencyMs < prev) {
        best.set(key, p.latencyMs);
      }
    }
  }
  return { pairs: Object.fromEntries(best), lastReportedAt };
}
