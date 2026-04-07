export const DEFAULT_REALITY_DEST = "www.microsoft.com:443";

/**
 * Normalize a reality dest string: ensure it has a port suffix (defaults to :443),
 * and derive the server name (hostname without port).
 */
export function normalizeRealityDest(input?: string | null): {
  realityDest: string;
  realityServerName: string;
} {
  const raw = input || DEFAULT_REALITY_DEST;
  const dest = raw.includes(":") ? raw : `${raw}:443`;
  return { realityDest: dest, realityServerName: dest.replace(/:\d+$/, "") };
}
