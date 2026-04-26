import type { DeviceContext } from "./types";
import {
  buildVlessUri,
  buildSocks5Uri,
  buildWireguardShadowrocketUri,
} from "./uri-builders";

/**
 * V2Ray-style URI for the universal subscription format consumed by
 * V2RayN / V2RayNG / Passwall and most "generic" clients.
 *
 * Modern clients (V2RayN v6+, V2RayNG v1.10+, NekoBox, Karing, FlClash…)
 * accept the SR-style `wg://` URI, so we emit it. Older or strictly-V2Ray
 * builds (legacy V2RayN, OpenWRT Passwall) silently ignore unknown schemes
 * — they keep working with the vless/socks5 entries and just drop wg://.
 */
export function buildV2RayUri(ctx: DeviceContext): string | null {
  if (ctx.protocol === "wireguard") return buildWireguardShadowrocketUri(ctx);
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
