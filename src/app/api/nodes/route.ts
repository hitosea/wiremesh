import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { nodes, settings, lineTunnels, lineNodes, lines } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { DEFAULT_PROXY_PORT } from "@/lib/proxy-port";
import packageJson from "../../../../package.json";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, or, like, count, and, inArray, SQL } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateNodeIp } from "@/lib/ip-allocator";
import { generateRealityKeypair, generateShortId } from "@/lib/reality";
import { normalizeRealityDest } from "@/lib/reality-dest";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");

  const conditions: SQL[] = [eq(nodes.pendingDelete, false)];
  if (search) {
    conditions.push(
      or(like(nodes.name, `%${search}%`), like(nodes.ip, `%${search}%`))!
    );
  }
  if (status) conditions.push(eq(nodes.status, status));
  const where = and(...conditions);

  const total =
    db.select({ count: count() }).from(nodes).where(where).get()?.count ?? 0;

  const rows = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      domain: nodes.domain,
      port: nodes.port,
      wgPublicKey: nodes.wgPublicKey,
      wgAddress: nodes.wgAddress,
      xrayProtocol: nodes.xrayProtocol,
      xrayTransport: nodes.xrayTransport,
      xrayPort: nodes.xrayPort,
      xrayConfig: nodes.xrayConfig,
      status: nodes.status,
      errorMessage: nodes.errorMessage,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
      agentVersion: nodes.agentVersion,
      xrayVersion: nodes.xrayVersion,
      upgradeTriggeredAt: nodes.upgradeTriggeredAt,
      xrayUpgradeTriggeredAt: nodes.xrayUpgradeTriggeredAt,
    })
    .from(nodes)
    .where(where)
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  const nodeIds = rows.map((r) => r.id);

  // Batch query tunnel ports for all nodes on this page
  const tunnelPortRows = nodeIds.length > 0
    ? db
        .select({
          nodeId: lineTunnels.fromNodeId,
          port: lineTunnels.fromWgPort,
        })
        .from(lineTunnels)
        .where(inArray(lineTunnels.fromNodeId, nodeIds))
        .all()
        .concat(
          db
            .select({
              nodeId: lineTunnels.toNodeId,
              port: lineTunnels.toWgPort,
            })
            .from(lineTunnels)
            .where(inArray(lineTunnels.toNodeId, nodeIds))
            .all()
        )
    : [];

  // Group tunnel ports by nodeId
  const tunnelPortMap = new Map<number, Set<number>>();
  for (const row of tunnelPortRows) {
    if (!tunnelPortMap.has(row.nodeId)) tunnelPortMap.set(row.nodeId, new Set());
    tunnelPortMap.get(row.nodeId)!.add(row.port);
  }

  // Batch query entry line info for proxy port calculation
  const entryLineRows = nodeIds.length > 0
    ? db
        .select({ nodeId: lineNodes.nodeId, lineId: lineNodes.lineId })
        .from(lineNodes)
        .where(and(inArray(lineNodes.nodeId, nodeIds), eq(lineNodes.hopOrder, 0)))
        .all()
    : [];

  // Group entry lines by nodeId
  const entryLineMap = new Map<number, number[]>();
  for (const row of entryLineRows) {
    if (!entryLineMap.has(row.nodeId)) entryLineMap.set(row.nodeId, []);
    entryLineMap.get(row.nodeId)!.push(row.lineId);
  }

  // Find all entry line IDs for batch proxy port query
  const allEntryLineIds = [...new Set(entryLineRows.map((r) => r.lineId))];

  // Batch query proxy ports from lines
  const linePortRows = allEntryLineIds.length > 0
    ? db.select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
        .from(lines).where(inArray(lines.id, allEntryLineIds)).all()
    : [];
  const linePortMap = new Map(linePortRows.map((r) => [r.id, r]));

  // Build ports for each node
  const rowsWithPorts = rows.map((row) => {
    const tunnels = [...(tunnelPortMap.get(row.id) ?? [])].sort((a, b) => a - b);
    const nodeEntryLines = entryLineMap.get(row.id) ?? [];

    // Read persisted proxy ports from lines table
    const xrayPorts: number[] = [];
    const socks5Ports: number[] = [];
    for (const lid of nodeEntryLines.sort((a, b) => a - b)) {
      const lp = linePortMap.get(lid);
      if (lp?.xrayPort !== null && lp?.xrayPort !== undefined) xrayPorts.push(lp.xrayPort);
      if (lp?.socks5Port !== null && lp?.socks5Port !== undefined) socks5Ports.push(lp.socks5Port);
    }

    return {
      ...row,
      ports: {
        wg: row.port,
        xray: xrayPorts,
        tunnels,
        socks5: socks5Ports,
      },
    };
  });

  return paginated(rowsWithPorts, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  }, { latestAgentVersion: packageJson.version });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    name,
    ip,
    domain,
    port,
    xrayPort,
    externalInterface,
    remark,
  } = body;

  if (!name || !ip) {
    return error("VALIDATION_ERROR", "validation.nameAndIpRequired");
  }

  // Check IP uniqueness
  const existing = db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.ip, ip))
    .get();
  if (existing) {
    return error("CONFLICT", "conflict.ipExists");
  }

  // Read settings
  const settingsRows = db.select().from(settings).all();
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) {
    settingsMap[row.key] = row.value;
  }

  // Determine port
  const resolvedPort =
    port ?? parseInt(settingsMap["wg_default_port"] ?? "41820");

  // Allocate WG address
  const usedAddresses = db
    .select({ wgAddress: nodes.wgAddress })
    .from(nodes)
    .all()
    .map((r) => r.wgAddress);
  const subnet = settingsMap["wg_default_subnet"] ?? "10.210.0.0/24";
  const startPos = parseInt(settingsMap["wg_node_ip_start"] ?? "1");
  const wgAddress = allocateNodeIp(usedAddresses, subnet, startPos);

  // Generate WG key pair
  const { privateKey, publicKey } = generateKeyPair();
  const encryptedPrivateKey = encrypt(privateKey);

  // Generate agent token
  const agentToken = uuidv4();

  // Always generate Reality keypair
  const realityKeys = generateRealityKeypair();
  const shortId = generateShortId();
  const { realityDest, realityServerName } = normalizeRealityDest(body.realityDest);
  const resolvedXrayConfig = JSON.stringify({
    realityPrivateKey: encrypt(realityKeys.privateKey),
    realityPublicKey: realityKeys.publicKey,
    realityShortId: shortId,
    realityDest,
    realityServerName,
  });

  const result = db
    .insert(nodes)
    .values({
      name,
      ip,
      domain: domain ?? null,
      port: resolvedPort,
      agentToken,
      wgPrivateKey: encryptedPrivateKey,
      wgPublicKey: publicKey,
      wgAddress,
      xrayProtocol: "vless",
      xrayTransport: "tcp",
      xrayPort: xrayPort ?? parseInt(settingsMap["xray_default_port"] ?? String(DEFAULT_PROXY_PORT)),
      xrayConfig: resolvedXrayConfig,
      externalInterface: externalInterface ?? "eth0",
      remark: remark ?? null,
    })
    .returning({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      domain: nodes.domain,
      port: nodes.port,
      agentToken: nodes.agentToken,
      wgPublicKey: nodes.wgPublicKey,
      wgAddress: nodes.wgAddress,
      xrayProtocol: nodes.xrayProtocol,
      xrayTransport: nodes.xrayTransport,
      xrayPort: nodes.xrayPort,
      xrayConfig: nodes.xrayConfig,
      externalInterface: nodes.externalInterface,
      status: nodes.status,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
    })
    .get();

  writeAuditLog({
    action: "create",
    targetType: "node",
    targetId: result.id,
    targetName: name,
    detail: `ip=${ip}, wgAddress=${wgAddress}`,
  });

  return created(result);
}
