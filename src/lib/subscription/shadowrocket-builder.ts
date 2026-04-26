import type { DeviceContext } from "./types";

function fragment(name: string): string {
  return `#${encodeURIComponent(name)}`;
}

export function buildShadowrocketUri(ctx: DeviceContext): string | null {
  const server = ctx.entry.domain ?? ctx.entry.ip;
  const tag = fragment(ctx.name);

  if (ctx.protocol === "wireguard" && ctx.wg) {
    const conf = [
      "[Interface]",
      `PrivateKey = ${ctx.wg.privateKey}`,
      `Address = ${ctx.wg.address}`,
      `DNS = ${ctx.entry.wgAddress}`,
      "",
      "[Peer]",
      `PublicKey = ${ctx.entry.wgPublicKey}`,
      `Endpoint = ${server}:${ctx.entry.wgPort}`,
      "AllowedIPs = 0.0.0.0/0",
      "PersistentKeepalive = 25",
      "",
    ].join("\n");
    const encoded = Buffer.from(conf, "utf8").toString("base64");
    return `wireguard://${encoded}${tag}`;
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
    // Shadowrocket-compatible socks5 URI form
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
  const text = lines.join("\n");
  return { body: Buffer.from(text, "utf8").toString("base64"), skipped };
}
