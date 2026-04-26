import type { DeviceContext } from "./types";
import { deviceDisplayName } from "./display-name";

function fragment(name: string): string {
  return `#${encodeURIComponent(name)}`;
}

/**
 * Encode a base64 value for inclusion in a wg:// query string.
 * Real Shadowrocket WG share links leave `/` un-encoded but escape
 * `+` and `=`, so we match that style; clients percent-decode either way.
 */
function encodeBase64Query(s: string): string {
  return s.replace(/\+/g, "%2B").replace(/=/g, "%3D");
}

export function buildShadowrocketUri(ctx: DeviceContext): string | null {
  const server = ctx.entry.domain ?? ctx.entry.ip;
  const tag = fragment(deviceDisplayName(ctx));

  if (ctx.protocol === "wireguard" && ctx.wg) {
    // Shadowrocket-compatible wg:// scheme. Format reference:
    //   wg://host:port?publicKey=...&privateKey=...&ip=...&dns=...&udp=1#name
    const params = [
      `publicKey=${encodeBase64Query(ctx.entry.wgPublicKey)}`,
      `privateKey=${encodeBase64Query(ctx.wg.privateKey)}`,
      `ip=${ctx.wg.addressIp}`,
      `dns=${ctx.entry.wgAddress}`,
      "udp=1",
      "mtu=1420",
    ].join("&");
    return `wg://${server}:${ctx.entry.wgPort}?${params}${tag}`;
  }

  if (ctx.protocol === "xray" && ctx.xray) {
    const port = ctx.lineXrayPort ?? ctx.entry.xrayPort;
    if (!port) return null;
    const transport = ctx.entry.xrayTransport ?? "reality";
    if (transport === "ws-tls") {
      const sni = ctx.entry.xrayTlsDomain ?? server;
      const path = ctx.entry.xrayWsPath ?? "/default";
      const params = new URLSearchParams({
        encryption: "none",
        security: "tls",
        type: "ws",
        host: sni,
        path,
        sni,
      });
      return `vless://${ctx.xray.uuid}@${sni}:${port}?${params.toString()}${tag}`;
    }
    if (!ctx.entry.realityPublicKey) return null;
    const params = new URLSearchParams({
      encryption: "none",
      flow: "xtls-rprx-vision",
      security: "reality",
      sni: ctx.entry.realityServerName ?? "www.microsoft.com",
      fp: "chrome",
      pbk: ctx.entry.realityPublicKey,
      type: "tcp",
    });
    if (ctx.entry.realityShortId) params.set("sid", ctx.entry.realityShortId);
    return `vless://${ctx.xray.uuid}@${server}:${port}?${params.toString()}${tag}`;
  }

  if (ctx.protocol === "socks5" && ctx.socks5) {
    const port = ctx.lineSocks5Port ?? ctx.entry.xrayPort;
    if (!port) return null;
    const userpass = encodeURIComponent(`${ctx.socks5.username}:${ctx.socks5.password}`);
    return `socks5://${userpass}@${server}:${port}${tag}`;
  }

  return null;
}

export function buildShadowrocketSubscription(ctxs: DeviceContext[]): { body: string; skipped: number } {
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
  // Real subscriptions use \r\n between URIs; some clients are picky.
  const text = lines.join("\r\n");
  return { body: Buffer.from(text, "utf8").toString("base64"), skipped };
}
