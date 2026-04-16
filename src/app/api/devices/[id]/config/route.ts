import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lineNodes, nodes, settings, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getXrayDefaultPort } from "@/lib/proxy-port";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "validation.invalidDeviceId");

  const device = db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();

  if (!device) return error("NOT_FOUND", "notFound.device");
  if (!device.lineId) return error("VALIDATION_ERROR", "validation.deviceNotBound");

  // Find entry node (hopOrder=0) for device's line
  const entryNodeRow = db
    .select({
      nodeId: lineNodes.nodeId,
      nodeName: nodes.name,
      nodeIp: nodes.ip,
      nodeDomain: nodes.domain,
      nodePort: nodes.port,
      nodeWgPublicKey: nodes.wgPublicKey,
      nodeXrayProtocol: nodes.xrayProtocol,
      nodeXrayTransport: nodes.xrayTransport,
      nodeXrayPort: nodes.xrayPort,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(and(eq(lineNodes.lineId, device.lineId), eq(lineNodes.hopOrder, 0)))
    .get();

  if (!entryNodeRow) return error("NOT_FOUND", "notFound.entryNode");

  const protocol = device.protocol;

  if (protocol === "wireguard") {
    if (!device.wgPrivateKey || !device.wgAddress || !device.wgPublicKey) {
      return error("VALIDATION_ERROR", "validation.deviceWgIncomplete");
    }

    let privateKey: string;
    try {
      privateKey = decrypt(device.wgPrivateKey);
    } catch {
      return error("INTERNAL_ERROR", "internal.decryptDeviceFailed");
    }

    // DNS always points to the entry node's WG IP. The agent runs a DNS proxy
    // there that forwards over DoT via the tunnel (when available), which
    // defeats GFW poisoning for domestic entry nodes and lets multi-branch
    // filters populate ipsets for domain-based routing.
    const entryNodeWgIp = db
      .select({ wgAddress: nodes.wgAddress })
      .from(nodes)
      .where(eq(nodes.id, entryNodeRow.nodeId))
      .get()?.wgAddress?.split("/")[0];

    const defaultDns = db.select().from(settings).where(eq(settings.key, "wg_default_dns")).get()?.value || "1.1.1.1";
    const dns = entryNodeWgIp || defaultDns;

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const config = `[Interface]
PrivateKey = ${privateKey}
Address = ${device.wgAddress}
DNS = ${dns}

[Peer]
PublicKey = ${entryNodeRow.nodeWgPublicKey}
Endpoint = ${endpoint}:${entryNodeRow.nodePort}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;
    const filename = `${device.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-wg.conf`;
    return success({ format: "wireguard", config, filename });
  }

  if (protocol === "xray") {
    if (!device.xrayUuid) {
      return error("VALIDATION_ERROR", "validation.deviceXrayIncomplete");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const lineRow = db.select({ xrayPort: lines.xrayPort }).from(lines).where(eq(lines.id, device.lineId!)).get();
    const xrayPort = lineRow?.xrayPort ?? (entryNodeRow.nodeXrayPort ?? getXrayDefaultPort());

    // Parse Reality settings from node's xrayConfig
    let realityPublicKey = "";
    let realityShortId = "";
    let realityServerName = "www.microsoft.com";

    const nodeXrayConfig = db
      .select({ xrayConfig: nodes.xrayConfig })
      .from(nodes)
      .where(eq(nodes.id, entryNodeRow.nodeId))
      .get();
    if (nodeXrayConfig?.xrayConfig) {
      try {
        const parsed = JSON.parse(nodeXrayConfig.xrayConfig);
        realityPublicKey = parsed.realityPublicKey ?? "";
        realityShortId = parsed.realityShortId ?? "";
        realityServerName = parsed.realityServerName ?? "www.microsoft.com";
      } catch (e) {
        console.warn(`[devices/${deviceId}/config] Failed to parse node xrayConfig:`, e);
      }
    }

    // Fetch transport fields for entry node
    const nodeTransport = db
      .select({ xrayTransport: nodes.xrayTransport, xrayTlsDomain: nodes.xrayTlsDomain, xrayWsPath: nodes.xrayWsPath })
      .from(nodes)
      .where(eq(nodes.id, entryNodeRow.nodeId))
      .get();
    const isWsTls = nodeTransport?.xrayTransport === "ws-tls";

    if (!isWsTls && !realityPublicKey) {
      return error("VALIDATION_ERROR", "validation.realityIncomplete");
    }

    const userConfig: Record<string, unknown> = { id: device.xrayUuid, encryption: "none" };
    if (!isWsTls) { userConfig.flow = "xtls-rprx-vision"; }

    let streamSettings: Record<string, unknown>;
    let shareLink: string;

    if (isWsTls) {
      const wsDomain = nodeTransport?.xrayTlsDomain ?? endpoint;
      const wsPath = nodeTransport?.xrayWsPath ?? "/default";
      streamSettings = {
        network: "ws",
        security: "tls",
        wsSettings: { path: wsPath, headers: { Host: wsDomain } },
        tlsSettings: { serverName: wsDomain },
      };
      const vlessParams = new URLSearchParams({
        encryption: "none",
        security: "tls",
        type: "ws",
        host: wsDomain,
        path: wsPath,
        sni: wsDomain,
      });
      shareLink = `vless://${device.xrayUuid}@${wsDomain}:${xrayPort}?${vlessParams.toString()}#${encodeURIComponent(device.name)}`;
    } else {
      streamSettings = {
        network: "tcp",
        security: "reality",
        realitySettings: {
          serverName: realityServerName,
          fingerprint: "chrome",
          publicKey: realityPublicKey,
          shortId: realityShortId,
        },
      };
      const vlessParams = new URLSearchParams({
        encryption: "none",
        flow: "xtls-rprx-vision",
        security: "reality",
        sni: realityServerName,
        fp: "chrome",
        pbk: realityPublicKey,
        sid: realityShortId,
        type: "tcp",
      });
      shareLink = `vless://${device.xrayUuid}@${endpoint}:${xrayPort}?${vlessParams.toString()}#${encodeURIComponent(device.name)}`;
    }

    const vnextAddress = isWsTls ? (nodeTransport?.xrayTlsDomain ?? endpoint) : endpoint;

    const xrayConfig = {
      log: { loglevel: "warning" },
      inbounds: [
        {
          port: 1080,
          protocol: "socks",
          settings: { auth: "noauth" },
        },
      ],
      outbounds: [
        {
          tag: "proxy",
          protocol: "vless",
          settings: {
            vnext: [
              {
                address: vnextAddress,
                port: xrayPort,
                users: [userConfig],
              },
            ],
          },
          streamSettings,
        },
        {
          tag: "direct",
          protocol: "freedom",
        },
      ],
    };

    const config = JSON.stringify(xrayConfig, null, 2);
    const filename = `${device.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-xray.json`;

    return success({ format: "xray", config, filename, shareLink });
  }

  if (protocol === "socks5") {
    if (!device.socks5Username || !device.socks5Password) {
      return error("VALIDATION_ERROR", "validation.deviceSocks5Incomplete");
    }

    let password: string;
    try {
      password = decrypt(device.socks5Password);
    } catch {
      return error("INTERNAL_ERROR", "internal.decryptDeviceFailed");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const lineRow = db.select({ socks5Port: lines.socks5Port }).from(lines).where(eq(lines.id, device.lineId!)).get();
    const socks5Port = lineRow?.socks5Port ?? (entryNodeRow.nodeXrayPort ?? getXrayDefaultPort());

    const proxyUrl = `socks5://${device.socks5Username}:${password}@${endpoint}:${socks5Port}`;

    return success({
      format: "socks5",
      proxyUrl,
      server: endpoint,
      port: socks5Port,
      username: device.socks5Username,
      password,
    });
  }

  return error("VALIDATION_ERROR", "validation.unsupportedProtocol");
}
