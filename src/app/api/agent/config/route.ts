import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, lineNodes, lineTunnels, devices } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { authenticateAgent } from "@/lib/agent-auth";

function getNodePublicHost(nodeId: number): string {
  const n = db.select({ ip: nodes.ip, domain: nodes.domain }).from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!n) return "";
  return n.domain || n.ip;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } }, { status: 401 });
  }

  const nodeId = node.id;

  // Decrypt WG private key
  let wgPrivateKey: string;
  try {
    wgPrivateKey = decrypt(node.wgPrivateKey);
  } catch {
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "密钥解密失败" } }, { status: 500 });
  }

  // Get all line_nodes for this node
  const myLineNodes = db
    .select()
    .from(lineNodes)
    .where(eq(lineNodes.nodeId, nodeId))
    .all();

  const lineIds = myLineNodes.map((ln) => ln.lineId);

  // ---- Peers (entry role: devices on lines where this node is entry) ----
  const entryLineIds = myLineNodes.filter((ln) => ln.role === "entry").map((ln) => ln.lineId);

  const peers: { publicKey: string; allowedIps: string }[] = [];
  if (entryLineIds.length > 0) {
    for (const lineId of entryLineIds) {
      const lineDevices = db
        .select({ wgPublicKey: devices.wgPublicKey, wgAddress: devices.wgAddress })
        .from(devices)
        .where(eq(devices.lineId, lineId))
        .all();
      for (const d of lineDevices) {
        if (d.wgPublicKey && d.wgAddress) {
          peers.push({ publicKey: d.wgPublicKey, allowedIps: d.wgAddress.split("/")[0] + "/32" });
        }
      }
    }
  }

  // ---- Tunnels ----
  const interfaces: {
    name: string;
    privateKey: string;
    address: string;
    listenPort: number;
    peerPublicKey: string;
    peerAddress: string;
    peerPort: number;
    role: "from" | "to";
  }[] = [];

  const iptablesRules: string[] = [];

  if (lineIds.length > 0) {
    for (const lineId of lineIds) {
      const tunnels = db
        .select()
        .from(lineTunnels)
        .where(
          or(
            eq(lineTunnels.fromNodeId, nodeId),
            eq(lineTunnels.toNodeId, nodeId)
          )
        )
        .all()
        .filter((t) => t.lineId === lineId);

      for (let i = 0; i < tunnels.length; i++) {
        const tunnel = tunnels[i];
        const ifaceName = `wm-tun${interfaces.length + 1}`;

        let privateKey: string;
        let address: string;
        let listenPort: number;
        let peerPublicKey: string;
        let peerAddress: string;
        let peerPort: number;
        let role: "from" | "to";

        if (tunnel.fromNodeId === nodeId) {
          // This node is the "from" side
          try { privateKey = decrypt(tunnel.fromWgPrivateKey); } catch { continue; }
          address = tunnel.fromWgAddress;
          listenPort = tunnel.fromWgPort;
          peerPublicKey = tunnel.toWgPublicKey;
          peerAddress = getNodePublicHost(tunnel.toNodeId);
          peerPort = tunnel.toWgPort;
          role = "from";
        } else {
          // This node is the "to" side
          try { privateKey = decrypt(tunnel.toWgPrivateKey); } catch { continue; }
          address = tunnel.toWgAddress;
          listenPort = tunnel.toWgPort;
          peerPublicKey = tunnel.fromWgPublicKey;
          peerAddress = getNodePublicHost(tunnel.fromNodeId);
          peerPort = tunnel.fromWgPort;
          role = "to";
        }

        interfaces.push({ name: ifaceName, privateKey, address, listenPort, peerPublicKey, peerAddress, peerPort, role });

        // Generate iptables rules based on role in this line
        const myRole = myLineNodes.find((ln) => ln.lineId === lineId)?.role;
        const lineTag = `wm-line-${lineId}`;

        if (myRole === "entry") {
          // entry: wm-wg0 <-> tun
          iptablesRules.push(`-A FORWARD -i wm-wg0 -o ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -o wm-wg0 -m comment --comment ${lineTag} -j ACCEPT`);
        } else if (myRole === "relay") {
          // relay: tun <-> tun (handled when both tunnels are processed)
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -o ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
        } else if (myRole === "exit") {
          // exit: tun -> eth0 + NAT
          // MASQUERADE all traffic from tunnel interface — source IPs include
          // both device subnet (10.0.0.x) and tunnel subnet (10.1.x.x)
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -o eth0 -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i eth0 -o ${ifaceName} -m state --state RELATED,ESTABLISHED -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-t nat -A POSTROUTING -o eth0 -j MASQUERADE -m comment --comment ${lineTag}`);
        }
      }
    }
  }

  // ---- Xray config ----
  let xrayConfig = null;
  if (node.xrayEnabled && node.xrayConfig) {
    try {
      xrayConfig = JSON.parse(node.xrayConfig);
    } catch {
      xrayConfig = node.xrayConfig;
    }
  }

  const config = {
    node: {
      id: node.id,
      name: node.name,
      ip: node.ip,
      wgAddress: node.wgAddress,
      wgPort: node.port,
      wgPrivateKey,
    },
    peers,
    tunnels: {
      interfaces,
      iptablesRules,
    },
    xray: xrayConfig,
    version: node.updatedAt,
  };

  return Response.json({ data: config });
}
