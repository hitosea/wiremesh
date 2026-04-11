import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, lineNodes, lineTunnels, devices, lineBranches, branchFilters, filters, settings } from "@/lib/db/schema";
import { eq, or, and, count } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { authenticateAgent } from "@/lib/agent-auth";
import { getXrayPortForLine, getProxyPortForLine, getXrayDefaultPort } from "@/lib/proxy-port";
import { BRANCH_MARK_START, XRAY_MARK_START, SOCKS5_MARK_START } from "@/lib/routing-constants";

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
  const extIface = node.externalInterface;

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
  const lineToDownstreamIface = new Map<number, string>(); // entry/relay: line -> default branch "from" tunnel
  const branchToDownstreamIface = new Map<number, string>(); // branchId -> "from" tunnel (for multi-branch lines)
  const lineToUpstreamIface = new Map<number, string>();   // exit/relay: line -> "to" tunnel

  const iptablesRules: string[] = [];

  // Track single-node lines (entry with no tunnels = entry+exit on same node)
  const singleNodeLineIds = new Set<number>();

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

      // Single-node line: this node is entry and there are no tunnels
      if (myRole === "entry" && tunnels.length === 0) {
        singleNodeLineIds.add(lineId);
        const lineTag = `wm-line-${lineId}`;
        // Direct forwarding: wm-wg0 → eth0 (no tunnel needed)
        iptablesRules.push(`-A FORWARD -i wm-wg0 -o ${extIface} -m comment --comment ${lineTag} -j ACCEPT`);
        iptablesRules.push(`-A FORWARD -i ${extIface} -o wm-wg0 -m state --state RELATED,ESTABLISHED -m comment --comment ${lineTag} -j ACCEPT`);
        iptablesRules.push(`-t nat -A POSTROUTING -s 10.0.0.0/8 -o ${extIface} -m comment --comment ${lineTag} -j MASQUERADE`);
        continue;
      }

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

        // Track tunnel-to-interface mappings
        if (role === "from") {
          if (tunnel.branchId) {
            branchToDownstreamIface.set(tunnel.branchId, ifaceName);
          }
          // Fallback: first "from" tunnel for this line (overwritten below for default branch)
          if (!lineToDownstreamIface.has(lineId)) {
            lineToDownstreamIface.set(lineId, ifaceName);
          }
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
          // MASQUERADE on the downstream tunnel so the exit node can route responses back
          if (role === "from") {
            iptablesRules.push(`-t nat -A POSTROUTING -o ${ifaceName} -s 10.0.0.0/8 -m comment --comment ${lineTag} -j MASQUERADE`);
          }
        } else if (myRole === "exit") {
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -o ${extIface} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i ${extIface} -o ${ifaceName} -m state --state RELATED,ESTABLISHED -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-t nat -A POSTROUTING -s 10.0.0.0/8 -o ${extIface} -m comment --comment ${lineTag} -j MASQUERADE`);
        }
      }
    }
  }

  // Cache lineBranches per entry line — reused by default-branch resolution, device routes, Xray, and routing configs
  const lineBranchCache = new Map<number, (typeof lineBranches.$inferSelect)[]>();
  for (const lineId of entryLineIds) {
    lineBranchCache.set(lineId, db.select().from(lineBranches).where(eq(lineBranches.lineId, lineId)).all());
  }

  // Resolve lineToDownstreamIface: for multi-branch lines, use the default branch's tunnel
  for (const [lineId, branches] of lineBranchCache) {
    const defaultBranch = branches.find((b) => b.isDefault);
    if (defaultBranch && branchToDownstreamIface.has(defaultBranch.id)) {
      lineToDownstreamIface.set(lineId, branchToDownstreamIface.get(defaultBranch.id)!);
    }
  }

  // ---- Device Routes ----
  // Maps each device IP to the tunnel interface it should use.
  // Entry nodes: device traffic FROM this IP goes through the downstream tunnel.
  // Exit nodes: return traffic TO this IP goes back through the upstream tunnel.
  const deviceRoutes: { destination: string; tunnel: string; type: string }[] = [];

  // Determine which lines have multi-branch routing (skip old entry device routes for those)
  const linesWithBranchRouting = new Set<number>();
  for (const [lineId, branches] of lineBranchCache) {
    if (branches.length > 1) {
      linesWithBranchRouting.add(lineId);
    }
  }

  // Entry node routes (source-based: traffic FROM this IP)
  // Skip for lines with branch routing — traffic routing is handled by fwmark-based branch routing instead
  // Skip for single-node lines — no tunnel, traffic uses default route
  for (const [lineId, ifaceName] of lineToDownstreamIface) {
    if (linesWithBranchRouting.has(lineId)) continue;
    if (singleNodeLineIds.has(lineId)) continue;
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

  // Precompute branch marks — single source of truth for both routing and Xray configs.
  // Branch marks are allocated sequentially from BRANCH_MARK_START (30001).
  // Single-branch lines still get marks allocated (for Xray) but routing skips them.
  const branchMarkMap = new Map<number, number>(); // branchId → mark
  let branchMarkSeq = BRANCH_MARK_START;
  for (const lineId of entryLineIds) {
    for (const branch of lineBranchCache.get(lineId) ?? []) {
      branchMarkMap.set(branch.id, branchMarkSeq++);
    }
  }

  const xrayDefaultPort = getXrayDefaultPort();

  if (node.xrayConfig) {
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
    const xrayBasePort = node.xrayPort ?? xrayDefaultPort;
    const xrayRoutes: {
      lineId: number; uuids: string[]; port: number; tunnel: string; mark: number;
      branches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[];
    }[] = [];
    let xrayPerLineMarkCounter = XRAY_MARK_START;

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
      const isSingleNode = singleNodeLineIds.has(lineId);
      const tunnel = isSingleNode ? extIface : lineToDownstreamIface.get(lineId);
      if (!tunnel) continue;

      // Build branch info for this line's Xray routing
      const xrayBranches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[] = [];
      let defaultMark = 0;

      for (const branch of lineBranchCache.get(lineId) ?? []) {
        const tunnelIfaceName = isSingleNode ? extIface : (branchToDownstreamIface.get(branch.id) ?? "");
        if (!tunnelIfaceName) continue;

        const branchMark = branchMarkMap.get(branch.id) ?? 0;

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
        mark: xrayPerLineMarkCounter++,
        branches: xrayBranches,
      });
    }

    // Only set dnsProxy when domain rules exist (agent DNS proxy only starts with domain rules)
    const hasDomainRules = xrayRoutes.some((r) => r.branches.some((b) => b.domain_rules.length > 0));
    xrayConfig = {
      enabled: true,
      protocol: "vless",
      port: xrayBasePort,
      realityPrivateKey,
      realityShortId: realitySettings.realityShortId ?? "",
      realityDest: realitySettings.realityDest ?? "www.microsoft.com:443",
      realityServerNames: [realitySettings.realityServerName ?? "www.microsoft.com"],
      routes: xrayRoutes,
      dnsProxy: hasDomainRules && node.wgAddress ? node.wgAddress.split("/")[0] : "",
    };
  }

  // ---- SOCKS5 config ----
  let socks5Config: {
    routes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[];
  } | null = null;

  if (entryLineIds.length > 0) {
    const socks5Routes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[] = [];
    let socks5MarkCounter = SOCKS5_MARK_START;
    const proxyBasePort = node.xrayPort ?? xrayDefaultPort;

    for (const lineId of entryLineIds) {
      const socks5Devices = db
        .select({ socks5Username: devices.socks5Username, socks5Password: devices.socks5Password })
        .from(devices)
        .where(and(eq(devices.lineId, lineId), eq(devices.protocol, "socks5")))
        .all()
        .filter((d) => d.socks5Username && d.socks5Password);

      if (socks5Devices.length === 0) continue;

      const users = socks5Devices.map((d) => {
        let password = "";
        try { password = decrypt(d.socks5Password!); } catch {}
        return { username: d.socks5Username!, password };
      }).filter((u) => u.password);

      if (users.length === 0) continue;

      const isSingleNode = singleNodeLineIds.has(lineId);
      const tunnel = isSingleNode ? extIface : (lineToDownstreamIface.get(lineId) ?? "");
      if (!tunnel) continue;

      const port = getProxyPortForLine(nodeId, lineId, "socks5", proxyBasePort);

      socks5Routes.push({
        lineId,
        port,
        mark: socks5MarkCounter++,
        tunnel,
        users,
      });
    }

    if (socks5Routes.length > 0) {
      socks5Config = { routes: socks5Routes };
    }
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
      device_ips: string[];
    }[] = [];
    for (const lineId of entryLineIds) {
      const lineBranchRows = lineBranchCache.get(lineId) ?? [];

      // Lines with a single branch don't need branch-based split-routing.
      // Device-level routing (ip rule from <device_ip>) already handles them.
      if (lineBranchRows.length <= 1) {
        continue;
      }

      // Collect device WG IPs for this line — used to scope PREROUTING rules per line
      const lineDeviceIPs = db
        .select({ wgAddress: devices.wgAddress })
        .from(devices)
        .where(eq(devices.lineId, lineId))
        .all()
        .map((d) => d.wgAddress?.split("/")[0])
        .filter((ip): ip is string => !!ip);

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
        if (singleNodeLineIds.has(lineId)) {
          tunnelIfaceName = extIface;
        } else if (branchTunnel) {
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
          mark: branchMarkMap.get(branch.id) ?? 0,
          ip_rules: ipRules,
          domain_rules: domainRules,
          rule_sources: ruleSources,
          device_ips: lineDeviceIPs,
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
    socks5: socks5Config,
    routing: routingConfig,
    version: node.updatedAt,
  };

  return Response.json({ data: config });
}
