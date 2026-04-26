import type { DeviceContext } from "./types";
import { deviceDisplayName } from "./display-name";

type SingboxOutbound = Record<string, unknown> & { tag: string; type: string };

function sanitizeTag(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[\n\r\t]/g, " ").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export function buildSingboxOutbound(ctx: DeviceContext): SingboxOutbound | null {
  const tag = sanitizeTag(deviceDisplayName(ctx), `device-${ctx.id}`);
  const server = ctx.entry.domain ?? ctx.entry.ip;

  if (ctx.protocol === "wireguard" && ctx.wg) {
    // Legacy outbound form — supported by sing-box 1.10+ and current
    // Hiddify-Next builds. The newer `endpoints` block is more idiomatic
    // but isn't universally accepted yet.
    return {
      tag,
      type: "wireguard",
      server,
      server_port: ctx.entry.wgPort,
      local_address: [`${ctx.wg.addressIp}/32`],
      private_key: ctx.wg.privateKey,
      peer_public_key: ctx.entry.wgPublicKey,
      mtu: 1420,
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
        tag,
        type: "vless",
        server: sni,
        server_port: port,
        uuid: ctx.xray.uuid,
        flow: "",
        packet_encoding: "packetaddr",
        tls: {
          enabled: true,
          server_name: sni,
          utls: { enabled: true, fingerprint: "chrome" },
        },
        transport: { type: "ws", path, headers: { Host: sni } },
      };
    }
    if (!ctx.entry.realityPublicKey) return null;
    return {
      tag,
      type: "vless",
      server,
      server_port: port,
      uuid: ctx.xray.uuid,
      flow: "xtls-rprx-vision",
      packet_encoding: "packetaddr",
      tls: {
        enabled: true,
        server_name: ctx.entry.realityServerName ?? "www.microsoft.com",
        utls: { enabled: true, fingerprint: "chrome" },
        reality: {
          enabled: true,
          public_key: ctx.entry.realityPublicKey,
          ...(ctx.entry.realityShortId ? { short_id: ctx.entry.realityShortId } : {}),
        },
      },
    };
  }

  if (ctx.protocol === "socks5" && ctx.socks5) {
    const port = ctx.lineSocks5Port ?? ctx.entry.xrayPort;
    if (!port) return null;
    return {
      tag,
      type: "socks",
      server,
      server_port: port,
      version: "5",
      username: ctx.socks5.username,
      password: ctx.socks5.password,
    };
  }

  return null;
}

export function buildSingboxOutbounds(
  ctxs: DeviceContext[]
): { outbounds: SingboxOutbound[]; skipped: number } {
  const out: SingboxOutbound[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const ctx of ctxs) {
    const ob = buildSingboxOutbound(ctx);
    if (!ob) {
      skipped++;
      continue;
    }
    let tag = ob.tag;
    let suffix = 2;
    while (seen.has(tag)) tag = `${ob.tag}-${suffix++}`;
    seen.add(tag);
    out.push({ ...ob, tag });
  }
  return { outbounds: out, skipped };
}
