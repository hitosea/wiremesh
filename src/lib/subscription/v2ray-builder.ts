import type { DeviceContext } from "./types";
import { buildVlessUri, buildSocks5Uri } from "./uri-builders";

/**
 * V2Ray-style URI for the universal subscription format consumed by
 * V2RayN / V2RayNG / Passwall and most "generic" clients.
 *
 * V2Ray core has no native WireGuard outbound, so wg:// is unsupported —
 * WireGuard devices are silently skipped (the renderer reports the count
 * via `skipped` so the UI can warn admins).
 */
export function buildV2RayUri(ctx: DeviceContext): string | null {
  if (ctx.protocol === "wireguard") return null;
  if (ctx.protocol === "xray") return buildVlessUri(ctx);
  if (ctx.protocol === "socks5") return buildSocks5Uri(ctx);
  return null;
}

export function buildV2RaySubscription(ctxs: DeviceContext[]): { body: string; skipped: number } {
  const lines: string[] = [];
  let skipped = 0;
  for (const ctx of ctxs) {
    const uri = buildV2RayUri(ctx);
    if (!uri) {
      skipped++;
      continue;
    }
    lines.push(uri);
  }
  const text = lines.join("\r\n");
  return { body: Buffer.from(text, "utf8").toString("base64"), skipped };
}
