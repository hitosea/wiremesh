import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { nodes, settings, lineTunnels, lineNodes, devices } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { DEFAULT_PROXY_PORT, getXrayDefaultPort } from "@/lib/proxy-port";
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

  const conditions: SQL[] = [];
  if (search) {
    conditions.push(
      or(like(nodes.name, `%${search}%`), like(nodes.ip, `%${search}%`))!
    );
  }
  if (status) conditions.push(eq(nodes.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

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

  // Find all lines that have xray or socks5 devices
  const allEntryLineIds = [...new Set(entryLineRows.map((r) => r.lineId))];
  const proxyDeviceRows = allEntryLineIds.length > 0
    ? db
        .select({ lineId: devices.lineId, protocol: devices.protocol })
        .from(devices)
        .where(
          and(
            inArray(devices.lineId, allEntryLineIds),
            or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))
          )
        )
        .all()
    : [];

  const xrayLineIds = new Set(proxyDeviceRows.filter((d) => d.protocol === "xray" && d.lineId != null).map((d) => d.lineId!));
  const socks5LineIds = new Set(proxyDeviceRows.filter((d) => d.protocol === "socks5" && d.lineId != null).map((d) => d.lineId!));

  const xrayDefaultPort = getXrayDefaultPort();

  // Build ports for each node
  const rowsWithPorts = rows.map((row) => {
    const tunnels = [...(tunnelPortMap.get(row.id) ?? [])].sort((a, b) => a - b);
    const nodeEntryLines = entryLineMap.get(row.id) ?? [];
    const basePort = row.xrayPort ?? xrayDefaultPort;

    // Inline port allocation matching getProxyPortForLine logic:
    // Allocate all Xray ports first, then SOCKS5 ports
    let port = basePort;
    const xrayPorts: number[] = [];
    for (const lid of nodeEntryLines) {
      if (xrayLineIds.has(lid)) {
        xrayPorts.push(port++);
      }
    }
    const socks5Ports: number[] = [];
    for (const lid of nodeEntryLines) {
      if (socks5LineIds.has(lid)) {
        socks5Ports.push(port++);
      }
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
  });
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
