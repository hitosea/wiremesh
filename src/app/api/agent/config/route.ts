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
  // Track lineId for each interface so we can compute device routes
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

  // Internal tracking: lineId -> interface name, by node role
  const lineToDownstreamIface = new Map<number, string>(); // entry: line -> "from" tunnel
  const lineToUpstreamIface = new Map<number, string>();   // exit: line -> "to" tunnel

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

      const myRole = myLineNodes.find((ln) => ln.lineId === lineId)?.role;

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
          try { privateKey = decrypt(tunnel.fromWgPrivateKey); } catch { continue; }
          address = tunnel.fromWgAddress;
          listenPort = tunnel.fromWgPort;
          peerPublicKey = tunnel.toWgPublicKey;
          peerAddress = getNodePublicHost(tunnel.toNodeId);
          peerPort = tunnel.toWgPort;
          role = "from";
        } else {
          try { privateKey = decrypt(tunnel.toWgPrivateKey); } catch { continue; }
          address = tunnel.toWgAddress;
          listenPort = tunnel.toWgPort;
          peerPublicKey = tunnel.fromWgPublicKey;
          peerAddress = getNodePublicHost(tunnel.fromNodeId);
          peerPort = tunnel.fromWgPort;
          role = "to";
        }

        interfaces.push({ name: ifaceName, privateKey, address, listenPort, peerPublicKey, peerAddress, peerPort, role });

        // Track line-to-interface mapping for device routes
        if (myRole === "entry" && role === "from") {
          lineToDownstreamIface.set(lineId, ifaceName);
        }
        if (myRole === "exit" && role === "to") {
          lineToUpstreamIface.set(lineId, ifaceName);
        }

        // Generate iptables rules based on role in this line
        const lineTag = `wm-line-${lineId}`;

        if (myRole === "entry") {
          iptablesRules.push(`-A FORWARD -i wm-wg0 -o ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -o wm-wg0 -m comment --comment ${lineTag} -j ACCEPT`);
        } else if (myRole === "relay") {
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -o ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
        } else if (myRole === "exit") {
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -o eth0 -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i eth0 -o ${ifaceName} -m state --state RELATED,ESTABLISHED -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-t nat -A POSTROUTING -s 10.0.0.0/8 -o eth0 -m comment --comment ${lineTag} -j MASQUERADE`);
        }
      }
    }
  }

  // ---- Device Routes ----
  // Maps each device IP to the tunnel interface it should use.
  // Entry nodes: device traffic FROM this IP goes through the downstream tunnel.
  // Exit nodes: return traffic TO this IP goes back through the upstream tunnel.
  const deviceRoutes: { destination: string; tunnel: string; type: string }[] = [];

  // Entry node routes (source-based: traffic FROM this IP)
  for (const [lineId, ifaceName] of lineToDownstreamIface) {
    const lineDevices = db
      .select({ wgAddress: devices.wgAddress })
      .from(devices)
      .where(eq(devices.lineId, lineId))
      .all();
    for (const d of lineDevices) {
      if (d.wgAddress) {
        deviceRoutes.push({ destination: d.wgAddress.split("/")[0] + "/32", tunnel: ifaceName, type: "entry" });
      }
    }
  }

  // Exit node routes (destination-based: return traffic TO this IP)
  for (const [lineId, ifaceName] of lineToUpstreamIface) {
    const lineDevices = db
      .select({ wgAddress: devices.wgAddress })
      .from(devices)
      .where(eq(devices.lineId, lineId))
      .all();
    for (const d of lineDevices) {
      if (d.wgAddress) {
        deviceRoutes.push({ destination: d.wgAddress.split("/")[0] + "/32", tunnel: ifaceName, type: "exit" });
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
      deviceRoutes,
    },
    xray: xrayConfig,
    version: node.updatedAt,
  };

  return Response.json({ data: config });
}
