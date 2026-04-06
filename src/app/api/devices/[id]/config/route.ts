import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lineNodes, nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  if (isNaN(deviceId)) return error("VALIDATION_ERROR", "无效的设备 ID");

  const device = db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();

  if (!device) return error("NOT_FOUND", "设备不存在");
  if (!device.lineId) return error("VALIDATION_ERROR", "设备未绑定线路，无法生成配置");

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

  if (!entryNodeRow) return error("NOT_FOUND", "未找到线路入口节点");

  const protocol = device.protocol;

  if (protocol === "wireguard") {
    if (!device.wgPrivateKey || !device.wgAddress || !device.wgPublicKey) {
      return error("VALIDATION_ERROR", "设备 WireGuard 配置不完整");
    }

    let privateKey: string;
    try {
      privateKey = decrypt(device.wgPrivateKey);
    } catch {
      return error("INTERNAL_ERROR", "解密设备私钥失败");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const config = `[Interface]
PrivateKey = ${privateKey}
Address = ${device.wgAddress}/32
DNS = 8.8.8.8

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
      return error("VALIDATION_ERROR", "设备 Xray UUID 不完整");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const xrayPort = entryNodeRow.nodeXrayPort ?? 443;
    const transport = entryNodeRow.nodeXrayTransport ?? "ws";

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
                  },
                ],
              },
            ],
          },
          streamSettings: {
            network: transport,
            security: "tls",
            ...(transport === "ws"
              ? { wsSettings: { path: "/ws" } }
              : { grpcSettings: { serviceName: "grpc" } }),
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
    return success({ format: "xray", config, filename });
  }

  return error("VALIDATION_ERROR", "不支持的协议类型");
}
