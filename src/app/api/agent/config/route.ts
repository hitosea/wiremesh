import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, lineNodes, lineTunnels, devices, lineBranches, branchFilters, filters, settings } from "@/lib/db/schema";
import { eq, or, and, count } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { authenticateAgent } from "@/lib/agent-auth";
import { getXrayPortForLine, DEFAULT_XRAY_PORT } from "@/lib/xray-port";
import { BRANCH_MARK_START, XRAY_MARK_START } from "@/lib/routing-constants";

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

  const lineIds = [...new Set(myLineNodes.map((ln) => ln.lineId))];

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
  const lineToDownstreamIface = new Map<number, string>(); // entry/relay: line -> "from" tunnel
  const lineToUpstreamIface = new Map<number, string>();   // exit/relay: line -> "to" tunnel

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
        if (role === "from") {
          lineToDownstreamIface.set(lineId, ifaceName); // entry or relay downstream
        }
        if (role === "to") {
          lineToUpstreamIface.set(lineId, ifaceName); // exit or relay upstream
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

  // Determine which lines have multi-branch routing (skip old entry device routes for those)
  const linesWithBranchRouting = new Set<number>();
  for (const lineId of entryLineIds) {
    const branchCount = db
      .select({ count: count() })
      .from(lineBranches)
      .where(eq(lineBranches.lineId, lineId))
      .get()?.count ?? 0;
    if (branchCount > 1) {
      linesWithBranchRouting.add(lineId);
    }
  }

  // Entry node routes (source-based: traffic FROM this IP)
  // Skip for lines with branch routing — traffic routing is handled by fwmark-based branch routing instead
  for (const [lineId, ifaceName] of lineToDownstreamIface) {
    if (linesWithBranchRouting.has(lineId)) continue;
    const myRole = myLineNodes.find((ln) => ln.lineId === lineId)?.role;
    if (myRole !== "entry") continue; // only entry nodes use source-based routing
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
    const myRole = myLineNodes.find((ln) => ln.lineId === lineId)?.role;
    if (myRole !== "exit") continue; // only exit nodes use destination-based routing
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

  // Relay node routes (iif-based: forward traffic from upstream tunnel to downstream tunnel)
  for (const lineId of lineIds) {
    const myRole = myLineNodes.find((ln) => ln.lineId === lineId)?.role;
    if (myRole !== "relay") continue;
    const upstreamIface = lineToUpstreamIface.get(lineId);
    const downstreamIface = lineToDownstreamIface.get(lineId);
    if (upstreamIface && downstreamIface) {
      deviceRoutes.push({ destination: upstreamIface, tunnel: downstreamIface, type: "relay" });
    }
  }

  // ---- Xray config ----
  // Build per-line Xray routes: each line gets its own outbound with fwmark
  let xrayConfig: {
    enabled: boolean;
    protocol: string;
    port: number;
    realityPrivateKey: string;
    realityShortId: string;
    realityDest: string;
    realityServerNames: string[];
    routes: { lineId: number; uuids: string[]; port: number; tunnel: string; mark: number; branches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[] }[];
    dnsProxy?: string;
  } | null = null;

  if (node.xrayEnabled && node.xrayConfig) {
    let realitySettings: {
      realityPrivateKey?: string;
      realityPublicKey?: string;
      realityShortId?: string;
      realityDest?: string;
      realityServerName?: string;
    } = {};
    try {
      realitySettings = JSON.parse(node.xrayConfig);
    } catch (e) {
      console.warn(`[agent/config] Failed to parse xrayConfig for node ${nodeId}:`, e);
    }

    let realityPrivateKey = "";
    if (realitySettings.realityPrivateKey) {
      try {
        realityPrivateKey = decrypt(realitySettings.realityPrivateKey);
      } catch {
        realityPrivateKey = "";
      }
    }

    // Build per-line routes — each line gets a dedicated Xray inbound port
    const xrayBasePort = node.xrayPort ?? DEFAULT_XRAY_PORT;
    const xrayRoutes: {
      lineId: number; uuids: string[]; port: number; tunnel: string; mark: number;
      branches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[];
    }[] = [];
    let xrayBranchMarkCounter = BRANCH_MARK_START;

    for (const lineId of entryLineIds) {
      const xrayDevices = db
        .select({ xrayUuid: devices.xrayUuid })
        .from(devices)
        .where(eq(devices.lineId, lineId))
        .all()
        .filter((d) => d.xrayUuid);

      const uuids = xrayDevices
        .map((d) => d.xrayUuid!)
        .filter((uuid) => uuid);

      if (uuids.length === 0) continue;

      // Find the downstream tunnel for this line (default branch)
      const tunnel = lineToDownstreamIface.get(lineId);
      if (!tunnel) continue;

      // Build branch info for this line's Xray routing
      const xrayBranches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[] = [];
      let defaultMark = 0;

      const branchRows = db.select().from(lineBranches).where(eq(lineBranches.lineId, lineId)).all();
      for (const branch of branchRows) {
        const branchTunnel = db
          .select()
          .from(lineTunnels)
          .where(and(eq(lineTunnels.branchId, branch.id), eq(lineTunnels.fromNodeId, nodeId)))
          .get();

        let tunnelIfaceName = "";
        if (branchTunnel) {
          const matchedIface = interfaces.find((iface) => iface.listenPort === branchTunnel.fromWgPort && iface.role === "from");
          if (matchedIface) tunnelIfaceName = matchedIface.name;
        }
        if (!tunnelIfaceName) continue;

        // The mark must match the routing config's branch marks (same counter)
        const branchMark = xrayBranchMarkCounter++;

        let domainRules: string[] = [];
        if (!branch.isDefault) {
          const bfRows = db.select({ filterId: branchFilters.filterId }).from(branchFilters).where(eq(branchFilters.branchId, branch.id)).all();
          for (const bf of bfRows) {
            const filter = db.select().from(filters).where(and(eq(filters.id, bf.filterId), eq(filters.isEnabled, true))).get();
            if (filter?.domainRules) {
              domainRules.push(...filter.domainRules.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0 && !l.startsWith("#")));
            }
          }
        }

        xrayBranches.push({ mark: branchMark, tunnel: tunnelIfaceName, is_default: branch.isDefault, domain_rules: domainRules });
        if (branch.isDefault) defaultMark = branchMark;
      }

      xrayRoutes.push({
        lineId,
        uuids,
        port: getXrayPortForLine(nodeId, lineId, xrayBasePort),
        tunnel,
        mark: defaultMark || XRAY_MARK_START,
        branches: xrayBranches,
      });
    }

    // Only set dnsProxy when domain rules exist (agent DNS proxy only starts with domain rules)
    const hasDomainRules = xrayRoutes.some((r) => r.branches.some((b) => b.domain_rules.length > 0));
    xrayConfig = {
      enabled: true,
      protocol: "vless",
      port: node.xrayPort ?? DEFAULT_XRAY_PORT,
      realityPrivateKey,
      realityShortId: realitySettings.realityShortId ?? "",
      realityDest: realitySettings.realityDest ?? "www.microsoft.com:443",
      realityServerNames: [realitySettings.realityServerName ?? "www.microsoft.com"],
      routes: xrayRoutes,
      dnsProxy: hasDomainRules && node.wgAddress ? node.wgAddress.split("/")[0] : "",
    };
  }

  // ---- Routing config (entry nodes only) ----
  let routingConfig: {
    enabled: boolean;
    dns: { listen: string; upstream: string[] };
    branches: {
      id: number;
      name: string;
      is_default: boolean;
      tunnel: string;
      mark: number;
      ip_rules: string[];
      domain_rules: string[];
      rule_sources: { filter_id: number; url: string; sync_interval: number }[];
    }[];
  } | null = null;

  if (entryLineIds.length > 0) {
    // Read settings
    const dnsUpstreamSetting = db.select().from(settings).where(eq(settings.key, "dns_upstream")).get();
    const filterSyncIntervalSetting = db.select().from(settings).where(eq(settings.key, "filter_sync_interval")).get();
    const dnsUpstream = dnsUpstreamSetting?.value ? dnsUpstreamSetting.value.split(",").map((s: string) => s.trim()) : ["8.8.8.8", "1.1.1.1"];
    const filterSyncInterval = filterSyncIntervalSetting?.value ? parseInt(filterSyncIntervalSetting.value, 10) : 86400;

    const branches: {
      id: number;
      name: string;
      is_default: boolean;
      tunnel: string;
      mark: number;
      ip_rules: string[];
      domain_rules: string[];
      rule_sources: { filter_id: number; url: string; sync_interval: number }[];
    }[] = [];
    let branchMarkCounter = BRANCH_MARK_START;

    for (const lineId of entryLineIds) {
      // Fetch branches for this line
      const lineBranchRows = db.select().from(lineBranches).where(eq(lineBranches.lineId, lineId)).all();

      for (const branch of lineBranchRows) {
        // Find tunnel from this entry node for this branch
        const branchTunnel = db
          .select()
          .from(lineTunnels)
          .where(
            and(
              eq(lineTunnels.branchId, branch.id),
              eq(lineTunnels.fromNodeId, nodeId)
            )
          )
          .get();

        // Match to interface name via fromWgPort
        let tunnelIfaceName = "";
        if (branchTunnel) {
          const matchedIface = interfaces.find((iface) => iface.listenPort === branchTunnel.fromWgPort && iface.role === "from");
          if (matchedIface) {
            tunnelIfaceName = matchedIface.name;
          }
        }

        // For default branch, rules are empty
        let ipRules: string[] = [];
        let domainRules: string[] = [];
        let ruleSources: { filter_id: number; url: string; sync_interval: number }[] = [];

        if (!branch.isDefault) {
          // Fetch associated enabled filters
          const bfRows = db
            .select({ filterId: branchFilters.filterId })
            .from(branchFilters)
            .where(eq(branchFilters.branchId, branch.id))
            .all();

          for (const bf of bfRows) {
            const filter = db
              .select()
              .from(filters)
              .where(and(eq(filters.id, bf.filterId), eq(filters.isEnabled, true)))
              .get();

            if (!filter) continue;

            // Parse IP rules from rules field (one per line)
            if (filter.rules) {
              const lines = filter.rules.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0 && !l.startsWith("#"));
              ipRules.push(...lines);
            }

            // Parse domain rules from domainRules field (one per line)
            if (filter.domainRules) {
              const lines = filter.domainRules.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0 && !l.startsWith("#"));
              domainRules.push(...lines);
            }

            // Collect rule sources (filters with sourceUrl)
            if (filter.sourceUrl) {
              ruleSources.push({
                filter_id: filter.id,
                url: filter.sourceUrl,
                sync_interval: filterSyncInterval,
              });
            }
          }
        }

        branches.push({
          id: branch.id,
          name: branch.name,
          is_default: branch.isDefault,
          tunnel: tunnelIfaceName,
          mark: branchMarkCounter++,
          ip_rules: ipRules,
          domain_rules: domainRules,
          rule_sources: ruleSources,
        });
      }
    }

    routingConfig = {
      enabled: true,
      dns: {
        listen: node.wgAddress.split("/")[0] + ":53",
        upstream: dnsUpstream,
      },
      branches,
    };
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
    routing: routingConfig,
    version: node.updatedAt,
  };

  return Response.json({ data: config });
}
