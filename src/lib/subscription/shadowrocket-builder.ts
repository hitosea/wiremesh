import type { DeviceContext } from "./types";
import {
  buildVlessUri,
  buildSocks5Uri,
  buildWireguardShadowrocketUri,
} from "./uri-builders";

export function buildShadowrocketUri(ctx: DeviceContext): string | null {
  if (ctx.protocol === "wireguard") return buildWireguardShadowrocketUri(ctx);
  if (ctx.protocol === "xray") return buildVlessUri(ctx);
  if (ctx.protocol === "socks5") return buildSocks5Uri(ctx);
  return null;
}

export function buildShadowrocketSubscription(
  ctxs: DeviceContext[],
  statusLine?: string | null
): { body: string; skipped: number } {
  const lines: string[] = [];
  let skipped = 0;
  for (const ctx of ctxs) {
    const uri = buildShadowrocketUri(ctx);
    if (!uri) {
      skipped++;
      continue;
    }
    lines.push(uri);
  }
  // SR's STATUS=... banner is a single prefix line ahead of the URI list;
  // the rest of the body is base64-decoded as a CRLF-joined URI list.
  const allLines = statusLine ? [statusLine, ...lines] : lines;
  const text = allLines.join("\r\n");
  return { body: Buffer.from(text, "utf8").toString("base64"), skipped };
}
