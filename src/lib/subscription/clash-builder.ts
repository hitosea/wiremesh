import type { DeviceContext, ClashProxy } from "./types";
import { deviceDisplayName } from "./display-name";

export function sanitizeProxyName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[,:#\n\r\t]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export function buildClashProxy(ctx: DeviceContext): ClashProxy | null {
  const name = sanitizeProxyName(deviceDisplayName(ctx), `device-${ctx.id}`);
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

  if (ctx.protocol === "xray-reality" && ctx.xray) {
    const port = ctx.linePort;
    if (!port) return null;
    if (!ctx.entry.xrayReality?.publicKey) return null;
    return {
      name,
      type: "vless",
      server,
      port,
      uuid: ctx.xray.uuid,
      tls: true,
      network: "tcp",
      udp: true,
      "packet-encoding": "xudp",
      flow: "xtls-rprx-vision",
      servername: ctx.entry.xrayReality.serverName ?? "www.microsoft.com",
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": ctx.entry.xrayReality.publicKey,
        ...(ctx.entry.xrayReality.shortId ? { "short-id": ctx.entry.xrayReality.shortId } : {}),
      },
    };
  }

  if (ctx.protocol === "xray-wstls" && ctx.xray) {
    const port = ctx.linePort;
    if (!port) return null;
    const sni = ctx.entry.xrayWsTls?.tlsDomain ?? server;
    const path = ctx.entry.xrayWsTls?.wsPath ?? "/default";
    return {
      name,
      type: "vless",
      server: sni,
      port,
      uuid: ctx.xray.uuid,
      tls: true,
      network: "ws",
      udp: true,
      "packet-encoding": "xudp",
      servername: sni,
      "client-fingerprint": "chrome",
      "ws-opts": {
        path,
        headers: { Host: sni },
      },
    };
  }

  if (ctx.protocol === "socks5" && ctx.socks5) {
    const port = ctx.linePort;
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
