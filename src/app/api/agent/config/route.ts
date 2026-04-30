import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, lineNodes, lineTunnels, devices, lineBranches, branchFilters, filters, settings, nodeProtocols, lineProtocols } from "@/lib/db/schema";
import { eq, or, and, count, inArray, ne } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { authenticateAgent } from "@/lib/agent-auth";
import { BRANCH_MARK_START, XRAY_MARK_START, SOCKS5_MARK_START } from "@/lib/routing-constants";
import { isPrivateIp } from "@/lib/ip-utils";
import { isXrayProtocol, transportToDeviceProtocol, type XrayTransport } from "@/lib/protocols";

function getNodeHostInfo(nodeId: number): { host: string; ip: string } | null {
  const n = db.select({ ip: nodes.ip, domain: nodes.domain }).from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!n) return null;
  return { host: n.domain || n.ip, ip: n.ip };
}

export const dynamic = "force-dynamic";

// ---- Types for the new Xray wire shape (mirrors agent/api/config_types.go XrayInbound) ----
type LineRouting = {
  mark: number;
  tunnel: string;
  branches: { mark: number; tunnel: string; is_default: boolean; domain_rules: string[] }[];
};

type XrayInboundJson = {
  lineId: number;
  transport: "reality" | "ws-tls";
  protocol: "vless";
  port: number;
  realityPrivateKey?: string;
  realityShortId?: string;
  realityDest?: string;
  realityServerNames?: string[];
  wsPath?: string;
  tlsDomain?: string;
  tlsCert?: string;
  tlsKey?: string;
  uuids: string[];
  mark: number;
  tunnel: string;
  branches: LineRouting["branches"];
};

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

  const lineIds = [...new Set(myLineNodes.map((ln) => ln.lineId))].sort((a, b) => a - b);

  // ---- Peers (entry role: devices on lines where this node is entry) ----
  const entryLineIds = [...new Set(myLineNodes.filter((ln) => ln.role === "entry").map((ln) => ln.lineId))].sort((a, b) => a - b);

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

  // Internal tracking. Branch-keyed (not line-keyed) because a node can play
  // different roles in different branches of the same line — e.g. relay in
  // branch A, exit in branch B — and each branch needs its own forwarding
  // rules. Line-keyed maps would collapse these onto a single iface and
  // silently drop traffic for the redundant branches.
  const lineToDownstreamIface = new Map<number, string>(); // lineId -> default-branch "from" tunnel (used as Xray/SOCKS5 default route fallback)
  const branchToDownstreamIface = new Map<number, string>(); // branchId -> "from" tunnel
  const branchToUpstreamIface = new Map<number, string>(); // branchId -> "to" tunnel

  // Per-branch role lookup. Entry-role rows have branchId=null and are not
  // tracked here; use entryLineIds for the entry check.
  type LineNodeRole = "entry" | "relay" | "exit";
  const myBranchRoles = new Map<number, LineNodeRole>();
  for (const ln of myLineNodes) {
    if (ln.branchId !== null) {
      myBranchRoles.set(ln.branchId, ln.role as LineNodeRole);
    }
  }
  const entryLineIdSet = new Set(entryLineIds);

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

      const isEntryOnThisLine = entryLineIdSet.has(lineId);

      // Single-node line: this node is entry and there are no tunnels
      if (isEntryOnThisLine && tunnels.length === 0) {
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
        const ifaceName = `wm-tun${tunnel.id}`;

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
          peerAddress = getNodeHostInfo(tunnel.toNodeId)?.host ?? "";
          peerPort = tunnel.toWgPort;
          role = "from";
        } else {
          try { privateKey = decrypt(tunnel.toWgPrivateKey); } catch { continue; }
          address = tunnel.toWgAddress;
          listenPort = tunnel.toWgPort;
          peerPublicKey = tunnel.fromWgPublicKey;
          const fromInfo = getNodeHostInfo(tunnel.fromNodeId);
          peerAddress = (fromInfo && isPrivateIp(fromInfo.ip)) ? "" : (fromInfo?.host ?? "");
          peerPort = tunnel.fromWgPort;
          role = "to";
        }

        interfaces.push({ name: ifaceName, privateKey, address, listenPort, peerPublicKey, peerAddress, peerPort, role });

        // Resolve role for THIS tunnel by its branch (not by lineId), so a
        // node that's relay in one branch and exit in another gets the right
        // rules per tunnel. Entry tunnels have branchId set but the entry
        // node's lineNodes row has branchId=null, so myBranchRoles won't
        // contain it — fall back via entryLineIdSet.
        const tunnelRole: LineNodeRole | undefined =
          (tunnel.branchId !== null ? myBranchRoles.get(tunnel.branchId) : undefined) ??
          (isEntryOnThisLine ? "entry" : undefined);

        if (role === "from") {
          if (tunnel.branchId !== null) {
            branchToDownstreamIface.set(tunnel.branchId, ifaceName);
          }
          // Fallback: first "from" tunnel for this line; the default-branch
          // resolution loop below may overwrite this for multi-branch lines.
          if (!lineToDownstreamIface.has(lineId)) {
            lineToDownstreamIface.set(lineId, ifaceName);
          }
        }
        if (role === "to") {
          if (tunnel.branchId !== null) {
            branchToUpstreamIface.set(tunnel.branchId, ifaceName);
          }
        }

        const lineTag = `wm-line-${lineId}`;

        if (tunnelRole === "entry") {
          iptablesRules.push(`-A FORWARD -i wm-wg0 -o ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -o wm-wg0 -m comment --comment ${lineTag} -j ACCEPT`);
        } else if (tunnelRole === "relay") {
          iptablesRules.push(`-A FORWARD -i ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -o ${ifaceName} -m comment --comment ${lineTag} -j ACCEPT`);
          // MASQUERADE on the downstream tunnel so the exit node can route responses back
          if (role === "from") {
            iptablesRules.push(`-t nat -A POSTROUTING -o ${ifaceName} -s 10.0.0.0/8 -m comment --comment ${lineTag} -j MASQUERADE`);
          }
        } else if (tunnelRole === "exit") {
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
    if (!entryLineIdSet.has(lineId)) continue; // only entry nodes use source-based routing
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

  // Exit node routes (destination-based: return traffic TO this IP).
  // Iterate per-branch so a node that's exit on multiple branches emits a
  // route per branch. Agent uses `ip route replace` so kernel keeps the last
  // installed; asymmetric routing handles the rest.
  const exitBranches = myLineNodes.filter((ln) => ln.role === "exit" && ln.branchId !== null);
  if (exitBranches.length > 0) {
    const exitLineIds = [...new Set(exitBranches.map((ln) => ln.lineId))];
    const exitDevicesByLine = new Map<number, string[]>();
    const rows = db
      .select({ lineId: devices.lineId, wgAddress: devices.wgAddress })
      .from(devices)
      .where(inArray(devices.lineId, exitLineIds))
      .all();
    for (const r of rows) {
      if (!r.wgAddress || r.lineId === null) continue;
      const dest = r.wgAddress.split("/")[0] + "/32";
      const arr = exitDevicesByLine.get(r.lineId) ?? [];
      arr.push(dest);
      exitDevicesByLine.set(r.lineId, arr);
    }
    for (const ln of exitBranches) {
      const upstreamIface = branchToUpstreamIface.get(ln.branchId!);
      if (!upstreamIface) continue;
      for (const dest of exitDevicesByLine.get(ln.lineId) ?? []) {
        deviceRoutes.push({ destination: dest, tunnel: upstreamIface, type: "exit" });
      }
    }
  }

  // Relay node routes (iif-based: forward traffic from upstream tunnel to
  // downstream tunnel). Per-branch: a node that's relay on multiple branches
  // of one line gets a separate iif rule per branch.
  for (const ln of myLineNodes) {
    if (ln.role !== "relay") continue;
    if (ln.branchId === null) continue;
    const upstreamIface = branchToUpstreamIface.get(ln.branchId);
    const downstreamIface = branchToDownstreamIface.get(ln.branchId);
    if (upstreamIface && downstreamIface) {
      deviceRoutes.push({ destination: upstreamIface, tunnel: downstreamIface, type: "relay" });
    }
  }

  // ---- Xray config ----
  // Precompute branch marks — single source of truth for both routing and Xray configs.
  // Use BRANCH_MARK_START + branchId for stable assignment that survives line additions.
  const branchMarkMap = new Map<number, number>(); // branchId → mark
  for (const lineId of entryLineIds) {
    for (const branch of lineBranchCache.get(lineId) ?? []) {
      branchMarkMap.set(branch.id, BRANCH_MARK_START + branch.id);
    }
  }

  // Helper: compute the routing (mark, default tunnel, branches) for one entry line.
  // Pure function — safe to call once per (line, transport) pair or memoize if needed.
  function computeLineRouting(lineId: number): LineRouting {
    const isSingleNode = singleNodeLineIds.has(lineId);
    const tunnel = isSingleNode ? extIface : (lineToDownstreamIface.get(lineId) ?? "");

    const branches: LineRouting["branches"] = [];
    for (const branch of lineBranchCache.get(lineId) ?? []) {
      // Direct-exit branches (no exit nodes) have no tunnel interface — they
      // route locally via extIface on the entry node. Treat them like
      // single-node lines for routing purposes so the branch still gets an
      // OUTPUT remap rule.
      const branchHasTunnel = branchToDownstreamIface.has(branch.id);
      const tunnelIfaceName = isSingleNode
        ? extIface
        : (branchHasTunnel ? branchToDownstreamIface.get(branch.id)! : extIface);
      if (!tunnelIfaceName) continue;

      const branchMark = branchMarkMap.get(branch.id) ?? 0;

      const domainRules: string[] = [];
      if (!branch.isDefault) {
        const bfRows = db.select({ filterId: branchFilters.filterId }).from(branchFilters).where(eq(branchFilters.branchId, branch.id)).all();
        for (const bf of bfRows) {
          const filter = db.select().from(filters).where(and(eq(filters.id, bf.filterId), eq(filters.isEnabled, true))).get();
          if (filter?.domainRules) {
            domainRules.push(...filter.domainRules.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0 && !l.startsWith("#")));
          }
        }
      }

      branches.push({ mark: branchMark, tunnel: tunnelIfaceName, is_default: branch.isDefault, domain_rules: domainRules });
    }

    return { mark: XRAY_MARK_START + lineId, tunnel, branches };
  }

  // Query node_protocols to discover which Xray transports are enabled on this node
  const npRows = db.select().from(nodeProtocols)
    .where(eq(nodeProtocols.nodeId, nodeId))
    .all();

  const xrayTransports: XrayTransport[] = npRows
    .filter(r => isXrayProtocol(r.protocol))
    .map(r => r.protocol === "xray-reality" ? "reality" as const : "ws-tls" as const);

  // Always point Xray at the agent DNS proxy on entry nodes.
  const xrayDnsProxy = node.wgAddress ? node.wgAddress.split("/")[0] : "";

  const xrayInbounds: XrayInboundJson[] = [];

  for (const transport of xrayTransports) {
    const dp = transportToDeviceProtocol(transport);
    const npRow = npRows.find(r => r.protocol === dp)!;
    let cfg: Record<string, string> = {};
    try {
      cfg = JSON.parse(npRow.config);
    } catch (e) {
      console.warn(`[agent/config] Failed to parse nodeProtocol config for node ${nodeId} protocol ${dp}:`, e);
    }

    for (const lineId of entryLineIds) {
      const lp = db.select().from(lineProtocols)
        .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, dp)))
        .get();
      if (!lp || lp.port == null) continue;

      const uuidRows = db.select({ uuid: devices.xrayUuid }).from(devices)
        .where(and(eq(devices.lineId, lineId), eq(devices.protocol, dp)))
        .all();
      const uuids = uuidRows.map(r => r.uuid).filter((u): u is string => !!u);
      if (uuids.length === 0) continue;

      const routing = computeLineRouting(lineId);
      if (!routing.tunnel) continue;

      const base: XrayInboundJson = {
        lineId, transport, protocol: "vless", port: lp.port,
        uuids,
        mark: routing.mark, tunnel: routing.tunnel, branches: routing.branches,
      };

      if (transport === "reality") {
        let realityPrivateKey = "";
        if (cfg.realityPrivateKey) {
          try { realityPrivateKey = decrypt(cfg.realityPrivateKey); } catch { realityPrivateKey = ""; }
        }
        xrayInbounds.push({
          ...base,
          realityPrivateKey,
          realityShortId: cfg.realityShortId ?? "",
          realityDest: cfg.realityDest ?? "www.microsoft.com:443",
          realityServerNames: [cfg.realityServerName ?? "www.microsoft.com"],
        });
      } else {
        let tlsKey = "";
        if (cfg.tlsKey) {
          try { tlsKey = decrypt(cfg.tlsKey); } catch { tlsKey = ""; }
        }
        xrayInbounds.push({
          ...base,
          wsPath: cfg.wsPath ?? "/default",
          tlsDomain: cfg.tlsDomain ?? "",
          tlsCert: cfg.tlsCert ?? "",
          tlsKey,
        });
      }
    }
  }

  const xrayConfig = xrayTransports.length > 0 && xrayInbounds.length > 0
    ? { enabled: true, inbounds: xrayInbounds, dnsProxy: xrayDnsProxy }
    : { enabled: false, inbounds: [] as XrayInboundJson[], dnsProxy: "" };

  // ---- SOCKS5 config ----
  let socks5Config: {
    routes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[];
  } | null = null;

  if (entryLineIds.length > 0) {
    const socks5Routes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[] = [];

    for (const lineId of entryLineIds) {
      const lp = db.select().from(lineProtocols)
        .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, "socks5")))
        .get();
      if (!lp || lp.port == null) continue;

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

      socks5Routes.push({
        lineId,
        port: lp.port,
        mark: SOCKS5_MARK_START + lineId,
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
    dns: { listen: string; upstream: string[]; bindDevice?: string };
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
    const dnsUpstream = dnsUpstreamSetting?.value ? dnsUpstreamSetting.value.split(",").map((s: string) => s.trim()) : ["tls://1.1.1.1", "tls://8.8.8.8"];
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

        // Direct-exit branch: no nodes configured, entry node serves as exit
        // and traffic leaves locally via the external interface.
        const branchHasNodes = (db
          .select({ cnt: count() })
          .from(lineNodes)
          .where(eq(lineNodes.branchId, branch.id))
          .get()?.cnt ?? 0) > 0;

        // Match to interface name via fromWgPort
        let tunnelIfaceName = "";
        if (singleNodeLineIds.has(lineId)) {
          tunnelIfaceName = extIface;
        } else if (!branchHasNodes) {
          tunnelIfaceName = extIface;
          // Direct-exit branches in mixed lines need FORWARD + MASQUERADE for traffic
          // to actually leave via extIface (single-node lines add these at the line
          // level; mixed lines need them per-branch).
          const branchTag = `wm-branch-${branch.id}-direct`;
          iptablesRules.push(`-A FORWARD -i wm-wg0 -o ${extIface} -m comment --comment ${branchTag} -j ACCEPT`);
          iptablesRules.push(`-A FORWARD -i ${extIface} -o wm-wg0 -m state --state RELATED,ESTABLISHED -m comment --comment ${branchTag} -j ACCEPT`);
          iptablesRules.push(`-t nat -A POSTROUTING -s 10.0.0.0/8 -o ${extIface} -m comment --comment ${branchTag} -j MASQUERADE`);
        } else if (branchTunnel) {
          const matchedIface = interfaces.find((iface) => iface.listenPort === branchTunnel.fromWgPort && iface.role === "from");
          if (matchedIface) {
            tunnelIfaceName = matchedIface.name;
          }
        }

        // For default branch, rules are empty
        const ipRules: string[] = [];
        const domainRules: string[] = [];
        const ruleSources: { filter_id: number; url: string; sync_interval: number }[] = [];

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

    // Pick the first "from" tunnel interface as the DNS upstream bind device.
    // This forces upstream queries out through the tunnel (reaching the
    // internet via a downstream relay/exit node) so domestic entry nodes
    // bypass local DNS tampering (UDP poisoning or TLS SNI blocking on DoT).
    // For single-node lines (entry==exit, no tunnels) bindDevice stays empty
    // and queries go out the node's default route normally.
    const dnsBindDevice = interfaces.find((i) => i.role === "from")?.name ?? "";

    routingConfig = {
      enabled: true,
      dns: {
        listen: node.wgAddress.split("/")[0] + ":53",
        upstream: dnsUpstream,
        ...(dnsBindDevice ? { bindDevice: dnsBindDevice } : {}),
      },
      branches,
    };
  }

  // Mesh peers for the all-pairs latency matrix. Skip self, pending-delete nodes,
  // and nodes whose only address is a private IP (a peer pinging that IP would
  // hit a different machine in its own LAN and report bogus RTT).
  const meshPeers = db
    .select({ id: nodes.id, ip: nodes.ip, domain: nodes.domain })
    .from(nodes)
    .where(and(ne(nodes.id, nodeId), eq(nodes.pendingDelete, false)))
    .all()
    .filter((n) => n.domain || !isPrivateIp(n.ip))
    .map((n) => ({ nodeId: n.id, host: n.domain || n.ip }));

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
    meshPeers,
    version: node.updatedAt,
    pending_delete: !!node.pendingDelete,
  };

  return Response.json({ data: config });
}
