import type { DeviceContext, ClashProxy } from "./types";

export function sanitizeProxyName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[,:#\n\r\t]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export function buildClashProxy(ctx: DeviceContext): ClashProxy | null {
  const name = sanitizeProxyName(ctx.name, `device-${ctx.id}`);
  const server = ctx.entry.domain ?? ctx.entry.ip;

  if (ctx.protocol === "wireguard" && ctx.wg) {
    return {
      name,
      type: "wireguard",
      server,
      port: ctx.entry.wgPort,
      ip: ctx.wg.addressIp,
      "private-key": ctx.wg.privateKey,
      "public-key": ctx.entry.wgPublicKey,
      "allowed-ips": ["0.0.0.0/0", "::/0"],
      dns: [ctx.entry.wgAddress],
      mtu: 1420,
      udp: true,
    };
  }

  if (ctx.protocol === "xray" && ctx.xray) {
    const port = ctx.lineXrayPort ?? ctx.entry.xrayPort;
    if (!port) return null;
    const transport = ctx.entry.xrayTransport ?? "reality";
    if (transport === "ws-tls") {
      const sni = ctx.entry.xrayTlsDomain ?? server;
      const path = ctx.entry.xrayWsPath ?? "/default";
      return {
        name,
        type: "vless",
        server: sni,
        port,
        uuid: ctx.xray.uuid,
        tls: true,
        network: "ws",
        servername: sni,
        "client-fingerprint": "chrome",
        "ws-opts": {
          path,
          headers: { Host: sni },
        },
      };
    }
    // reality
    if (!ctx.entry.realityPublicKey) return null;
    return {
      name,
      type: "vless",
      server,
      port,
      uuid: ctx.xray.uuid,
      tls: true,
      network: "tcp",
      flow: "xtls-rprx-vision",
      servername: ctx.entry.realityServerName ?? "www.microsoft.com",
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": ctx.entry.realityPublicKey,
        ...(ctx.entry.realityShortId ? { "short-id": ctx.entry.realityShortId } : {}),
      },
    };
  }

  if (ctx.protocol === "socks5" && ctx.socks5) {
    const port = ctx.lineSocks5Port ?? ctx.entry.xrayPort;
    if (!port) return null;
    return {
      name,
      type: "socks5",
      server,
      port,
      username: ctx.socks5.username,
      password: ctx.socks5.password,
      udp: true,
    };
  }

  return null;
}

export function buildClashProxies(ctxs: DeviceContext[]): { proxies: ClashProxy[]; skipped: number } {
  const proxies: ClashProxy[] = [];
  let skipped = 0;
  const seenNames = new Set<string>();
  for (const ctx of ctxs) {
    const proxy = buildClashProxy(ctx);
    if (!proxy) {
      skipped++;
      continue;
    }
    // Deduplicate names to avoid Clash schema collision
    let name = proxy.name;
    let suffix = 2;
    while (seenNames.has(name)) {
      name = `${proxy.name}-${suffix++}`;
    }
    seenNames.add(name);
    proxies.push({ ...proxy, name });
  }
  return { proxies, skipped };
}
