// Shared helpers for the node-to-node latency matrix. Pure (no side effects),
// safe to import from both server and client modules.

export type LatencyMatrix = {
  pairs: Record<string, number>; // canonical "min-max" key -> best-of RTT in ms
  lastReportedAt: number | null;
};

// pairKey produces a canonical bidirectional key (smaller id first) so the same
// link is keyed identically regardless of which side reported it.
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function lookupRtt(
  pairs: Record<string, number>,
  a: number,
  b: number
): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return pairs[pairKey(a, b)] ?? null;
}
