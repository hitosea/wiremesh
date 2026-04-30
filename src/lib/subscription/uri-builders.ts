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

export function buildVlessUri(ctx: DeviceContext): string | null {
  if (!ctx.xray) return null;
  const server = ctx.entry.domain ?? ctx.entry.ip;
  const tag = fragment(deviceDisplayName(ctx));
  const port = ctx.linePort;
  if (!port) return null;

  if (ctx.protocol === "xray-wstls") {
    const sni = ctx.entry.xrayWsTls?.tlsDomain ?? server;
    const path = ctx.entry.xrayWsTls?.wsPath ?? "/default";
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

  if (ctx.protocol === "xray-reality") {
    if (!ctx.entry.xrayReality?.publicKey) return null;
    const params = new URLSearchParams({
      encryption: "none",
      flow: "xtls-rprx-vision",
      security: "reality",
      sni: ctx.entry.xrayReality.serverName ?? "www.microsoft.com",
      fp: "chrome",
      pbk: ctx.entry.xrayReality.publicKey,
      type: "tcp",
    });
    if (ctx.entry.xrayReality.shortId) params.set("sid", ctx.entry.xrayReality.shortId);
    return `vless://${ctx.xray.uuid}@${server}:${port}?${params.toString()}${tag}`;
  }

  return null;
}

export function buildSocks5Uri(ctx: DeviceContext): string | null {
  if (ctx.protocol !== "socks5" || !ctx.socks5) return null;
  const server = ctx.entry.domain ?? ctx.entry.ip;
  const port = ctx.linePort;
  if (!port) return null;
  const tag = fragment(deviceDisplayName(ctx));
  const userpass = encodeURIComponent(`${ctx.socks5.username}:${ctx.socks5.password}`);
  return `socks5://${userpass}@${server}:${port}${tag}`;
}

/**
 * Shadowrocket-flavored WireGuard URI:
 *   wg://host:port?publicKey=...&privateKey=...&ip=...&dns=...&udp=1&mtu=1420#name
 * Most plain-V2Ray clients (V2RayN/NG, Passwall) do NOT understand wg:// —
 * use this only for shadowrocket and explicitly skip WG in v2ray-flavored output.
 */
export function buildWireguardShadowrocketUri(ctx: DeviceContext): string | null {
  if (ctx.protocol !== "wireguard" || !ctx.wg) return null;
  const server = ctx.entry.domain ?? ctx.entry.ip;
  const tag = fragment(deviceDisplayName(ctx));
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
