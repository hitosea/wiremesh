const FALLBACK_PORT = 41443;

/** Compute interpolation params for xrayPortHint translation string. */
export function xrayPortHintParams(xrayPort: string, defaultPort?: string) {
  const base = parseInt(xrayPort || defaultPort || String(FALLBACK_PORT)) || FALLBACK_PORT;
  return { port0: base, port1: base + 1, port2: base + 2 };
}
