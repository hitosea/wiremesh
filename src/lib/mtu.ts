export const BUILTIN_DEFAULT_MTU = 1420;
export const MIN_MTU = 1280;
export const MAX_MTU = 9000;

export function parseMtu(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < MIN_MTU || n > MAX_MTU) return null;
  return n;
}

export function resolveNodeMtu(nodeMtu: unknown, systemDefaultMtu: unknown): number {
  return parseMtu(nodeMtu) ?? parseMtu(systemDefaultMtu) ?? BUILTIN_DEFAULT_MTU;
}

export function effectiveTunnelMtu(fromNodeMtu: unknown, toNodeMtu: unknown, systemDefaultMtu: unknown): number {
  return Math.min(resolveNodeMtu(fromNodeMtu, systemDefaultMtu), resolveNodeMtu(toNodeMtu, systemDefaultMtu));
}
