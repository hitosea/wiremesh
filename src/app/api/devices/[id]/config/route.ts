import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lineNodes, nodes, settings, lineBranches } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and, count } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getXrayPortForLine, getProxyPortForLine, getXrayDefaultPort } from "@/lib/proxy-port";

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
      nodeXrayEnabled: nodes.xrayEnabled,
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

    // For lines with branch routing (multi-branch), DNS must point to entry node's
    // DNS proxy so domain-based routing rules can resolve IPs into ipsets
    const branchCount = db
      .select({ count: count() })
      .from(lineBranches)
      .where(eq(lineBranches.lineId, device.lineId!))
      .get()?.count ?? 0;

    const entryNodeWgIp = db
      .select({ wgAddress: nodes.wgAddress })
      .from(nodes)
      .where(eq(nodes.id, entryNodeRow.nodeId))
      .get()?.wgAddress?.split("/")[0];

    const defaultDns = db.select().from(settings).where(eq(settings.key, "wg_default_dns")).get()?.value || "1.1.1.1";
    const dns = (branchCount > 1 && entryNodeWgIp) ? entryNodeWgIp : defaultDns;

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

    if (!entryNodeRow.nodeXrayEnabled) {
      return error("VALIDATION_ERROR", "validation.entryNodeNoXray");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const xrayBasePort = entryNodeRow.nodeXrayPort ?? getXrayDefaultPort();
    const xrayPort = getXrayPortForLine(entryNodeRow.nodeId, device.lineId!, xrayBasePort);

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

    if (!realityPublicKey) {
      return error("VALIDATION_ERROR", "validation.realityIncomplete");
    }

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
                address: endpoint,
                port: xrayPort,
                users: [
                  {
                    id: device.xrayUuid,
                    encryption: "none",
                    flow: "xtls-rprx-vision",
                  },
                ],
              },
            ],
          },
          streamSettings: {
            network: "tcp",
            security: "reality",
            realitySettings: {
              serverName: realityServerName,
              fingerprint: "chrome",
              publicKey: realityPublicKey,
              shortId: realityShortId,
            },
          },
        },
        {
          tag: "direct",
          protocol: "freedom",
        },
      ],
    };

    const config = JSON.stringify(xrayConfig, null, 2);
    const filename = `${device.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-xray.json`;

    // Build VLESS share link (for Shadowrocket, v2rayN, etc.)
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
    const shareLink = `vless://${device.xrayUuid}@${endpoint}:${xrayPort}?${vlessParams.toString()}#${encodeURIComponent(device.name)}`;

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
    const basePort = entryNodeRow.nodeXrayPort ?? getXrayDefaultPort();
    const socks5Port = getProxyPortForLine(entryNodeRow.nodeId, device.lineId!, "socks5", basePort);

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
