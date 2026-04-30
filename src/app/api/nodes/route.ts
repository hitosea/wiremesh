import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { nodes, settings, lineTunnels, lineNodes, lineProtocols } from "@/lib/db/schema";
import { created, error, paginated } from "@/lib/api-response";
import packageJson from "../../../../package.json";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, or, like, count, and, inArray, SQL } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateNodeIp } from "@/lib/ip-allocator";
import { generateRealityKeypair, generateShortId } from "@/lib/reality";
import { normalizeRealityDest } from "@/lib/reality-dest";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";
import { enableNodeProtocol, getNodeProtocols } from "@/lib/db/protocols";

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
      xrayBasePort: nodes.xrayBasePort,
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

  // Batch query proxy ports from line_protocols
  const lineProtocolRows = allEntryLineIds.length > 0
    ? db.select({ lineId: lineProtocols.lineId, protocol: lineProtocols.protocol, port: lineProtocols.port })
        .from(lineProtocols)
        .where(inArray(lineProtocols.lineId, allEntryLineIds))
        .all()
    : [];

  // Map lineId -> { protocol, port }[] for per-protocol port groups
  const linePortMap = new Map<number, { protocol: string; port: number }[]>();
  for (const row of lineProtocolRows) {
    if (row.port === null || row.port === undefined) continue; // wireguard rows have null ports
    const list = linePortMap.get(row.lineId) ?? [];
    list.push({ protocol: row.protocol, port: row.port });
    linePortMap.set(row.lineId, list);
  }

  // Build ports for each node
  const rowsWithPorts = rows.map((row) => {
    const tunnels = [...(tunnelPortMap.get(row.id) ?? [])].sort((a, b) => a - b);
    const nodeEntryLines = entryLineMap.get(row.id) ?? [];

    // Aggregate per-protocol port lists across all entry lines for this node
    const byProtocol = new Map<string, { lineId: number; port: number }[]>();
    for (const lid of nodeEntryLines.sort((a, b) => a - b)) {
      const entries = linePortMap.get(lid) ?? [];
      for (const { protocol, port } of entries) {
        const list = byProtocol.get(protocol) ?? [];
        list.push({ lineId: lid, port });
        byProtocol.set(protocol, list);
      }
    }

    const groups = Array.from(byProtocol.entries()).map(([protocol, ports]) => ({
      protocol,
      ports: ports.sort((a, b) => a.port - b.port),
    }));

    return {
      ...row,
      ports: {
        wg: row.port,
        tunnels,
        groups,
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
    name, ip, domain, port,
    externalInterface, remark,
    protocols,
  } = body as {
    name: string; ip: string; domain?: string; port?: number;
    externalInterface?: string; remark?: string;
    protocols?: {
      xrayReality?: { realityDest?: string };
      xrayWsTls?: { tlsDomain: string; certMode: "auto" | "manual"; tlsCert?: string; tlsKey?: string };
    };
  };

  const xrayBasePort = body.xrayBasePort != null && body.xrayBasePort !== ""
    ? parseInt(String(body.xrayBasePort), 10)
    : null;
  if (xrayBasePort != null && (!Number.isFinite(xrayBasePort) || xrayBasePort < 1 || xrayBasePort > 65535)) {
    return error("VALIDATION_ERROR", "validation.xrayBasePortInvalid");
  }

  if (!name || !ip) {
    return error("VALIDATION_ERROR", "validation.nameAndIpRequired");
  }

  const reality = protocols?.xrayReality;
  const wsTls = protocols?.xrayWsTls;
  if (!reality && !wsTls) {
    return error("VALIDATION_ERROR", "validation.xrayTransportRequired");
  }
  if (wsTls && !wsTls.tlsDomain?.trim()) {
    return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
  }

  // Check IP uniqueness (exclude soft-deleted nodes)
  const existing = db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.ip, ip), eq(nodes.pendingDelete, false)))
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

  // Insert node + protocol rows atomically so a failed protocol write never
  // leaves an orphaned node row in the DB.
  const result = db.transaction((tx) => {
    const inserted = tx
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
        xrayBasePort: xrayBasePort ?? null,
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
        externalInterface: nodes.externalInterface,
        status: nodes.status,
        remark: nodes.remark,
        createdAt: nodes.createdAt,
        updatedAt: nodes.updatedAt,
      })
      .get();

    // Persist protocol configurations into node_protocols
    if (reality) {
      const kp = generateRealityKeypair();
      const shortId = generateShortId();
      const { realityDest, realityServerName } = normalizeRealityDest(reality.realityDest);
      enableNodeProtocol(tx, inserted.id, "xray-reality", {
        realityPrivateKey: encrypt(kp.privateKey),
        realityPublicKey: kp.publicKey,
        realityShortId: shortId,
        realityDest,
        realityServerName,
      });
    }
    if (wsTls) {
      enableNodeProtocol(tx, inserted.id, "xray-wstls", {
        wsPath: "/" + randomBytes(4).toString("hex"),
        tlsDomain: wsTls.tlsDomain.trim(),
        certMode: wsTls.certMode,
        tlsCert: wsTls.certMode === "manual" ? wsTls.tlsCert ?? null : null,
        tlsKey: wsTls.certMode === "manual" && wsTls.tlsKey ? encrypt(wsTls.tlsKey) : null,
      });
    }

    return inserted;
  });

  writeAuditLog({
    action: "create",
    targetType: "node",
    targetId: result.id,
    targetName: name,
    detail: `ip=${ip}, wgAddress=${wgAddress}`,
  });

  // Existing agents need to refresh their mesh peer list to start probing the
  // new node. The new node hasn't connected yet, so excluding it is fine.
  sseManager.notifyAllConfigUpdate(result.id);

  // Build protocols response (omit private keys)
  const npRows = getNodeProtocols(db, result.id);
  const protocolsResp: { xrayReality: object | null; xrayWsTls: object | null } = {
    xrayReality: null,
    xrayWsTls: null,
  };
  for (const row of npRows) {
    const cfg = JSON.parse(row.config);
    if (row.protocol === "xray-reality") {
      protocolsResp.xrayReality = {
        realityDest: cfg.realityDest,
        realityPublicKey: cfg.realityPublicKey,
        realityShortId: cfg.realityShortId,
        realityServerName: cfg.realityServerName,
      };
    } else if (row.protocol === "xray-wstls") {
      protocolsResp.xrayWsTls = {
        tlsDomain: cfg.tlsDomain,
        certMode: cfg.certMode,
        wsPath: cfg.wsPath,
        hasCert: !!cfg.tlsCert,
      };
    }
  }

  return created({ ...result, protocols: protocolsResp });
}
