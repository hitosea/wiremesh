// Process-local in-memory cache of latest tunnel status snapshots reported by agents.
//
// SINGLE-PROCESS ASSUMPTION: This cache lives in the Next.js process memory.
// Reports received in one process won't be visible to others. Acceptable for
// the current single-instance deployment. If we ever scale to multiple replicas
// (K8s, etc.), replace with Redis or another shared store.
//
// Survives Next.js dev hot-reload via globalThis singleton.

export type TunnelStatusReport = {
  iface: string;
  peerPublicKey: string;
  lastHandshake: number;  // unix seconds, 0 = never
  rxBytes: number;
  txBytes: number;
  latencyMs: number | null;  // null = unreachable or measurement skipped
};

export type NodeSnapshot = {
  reportedAt: number;     // unix seconds, when platform received this report
  tunnels: TunnelStatusReport[];
};

type CacheStore = Map<number, NodeSnapshot>;

const CACHE_VERSION = 1;
const globalForCache = globalThis as typeof globalThis & {
  tunnelStatusCache?: CacheStore;
  tunnelStatusCacheVersion?: number;
};

if (!globalForCache.tunnelStatusCache || globalForCache.tunnelStatusCacheVersion !== CACHE_VERSION) {
  globalForCache.tunnelStatusCache = new Map();
  globalForCache.tunnelStatusCacheVersion = CACHE_VERSION;
}

const cache = globalForCache.tunnelStatusCache;

export function setNodeSnapshot(nodeId: number, tunnels: TunnelStatusReport[]): void {
  cache.set(nodeId, {
    reportedAt: Math.floor(Date.now() / 1000),
    tunnels,
  });
}

export function getNodeSnapshot(nodeId: number): NodeSnapshot | null {
  return cache.get(nodeId) ?? null;
}

export function clearAllSnapshots(): void {
  cache.clear();
}
