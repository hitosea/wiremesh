import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { devices, settings, nodes, lineNodes, lines } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, or, like, count, and, gt, lte, isNull, sql, SQL } from "drizzle-orm";
import { encrypt, generateRandomString } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateDeviceIp } from "@/lib/ip-allocator";
import { allocateProxyPort, getXrayDefaultPort } from "@/lib/proxy-port";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";
import { computeDeviceStatus } from "@/lib/device-status";

function getEntryNodeId(lineId: number): number | null {
  const entry = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry"))).get();
  return entry?.nodeId ?? null;
}

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");
  const protocol = request.nextUrl.searchParams.get("protocol");

  const conditions: SQL[] = [];
  if (search) {
    conditions.push(like(devices.name, `%${search}%`));
  }
  if (status) {
    const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if (status === "online") {
      conditions.push(gt(devices.lastHandshake, threshold));
    } else {
      conditions.push(
        or(
          isNull(devices.lastHandshake),
          lte(devices.lastHandshake, threshold),
        )!
      );
    }
  }
  if (protocol) conditions.push(eq(devices.protocol, protocol));
  const lineId = request.nextUrl.searchParams.get("lineId");
  if (lineId) conditions.push(eq(devices.lineId, parseInt(lineId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db.select({ count: count() }).from(devices).where(where).get()?.count ?? 0;

  const rows = db
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgPublicKey: devices.wgPublicKey,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
      xrayConfig: devices.xrayConfig,
      lineId: devices.lineId,
      status: devices.status,
      lastHandshake: devices.lastHandshake,
      remark: devices.remark,
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt,
    })
    .from(devices)
    .where(where)
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  const data = rows.map((row) => ({
    ...row,
    status: computeDeviceStatus(row.lastHandshake),
  }));

  return paginated(data, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, protocol, lineId, remark } = body;

  if (!name) {
    return error("VALIDATION_ERROR", "validation.nameRequired");
  }
  if (!protocol || !["wireguard", "xray", "socks5"].includes(protocol)) {
    return error("VALIDATION_ERROR", "validation.protocolInvalid");
  }

  // Read settings
  const settingsRows = db.select().from(settings).all();
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) {
    settingsMap[row.key] = row.value;
  }

  let wgPublicKey: string | null = null;
  let wgPrivateKey: string | null = null;
  let wgAddress: string | null = null;
  let xrayUuid: string | null = null;
  let socks5Username: string | null = null;
  let socks5Password: string | null = null;

  if (protocol === "wireguard") {
    // Generate key pair
    const keyPair = generateKeyPair();
    wgPublicKey = keyPair.publicKey;
    wgPrivateKey = encrypt(keyPair.privateKey);

    // Allocate IP from device range
    const usedNodeAddresses = db
      .select({ wgAddress: nodes.wgAddress })
      .from(nodes)
      .all()
      .map((r) => r.wgAddress);
    const usedDeviceAddresses = db
      .select({ wgAddress: devices.wgAddress })
      .from(devices)
      .all()
      .map((r) => r.wgAddress)
      .filter((a): a is string => a !== null);
    const usedAddresses = [...usedNodeAddresses, ...usedDeviceAddresses];

    const subnet = settingsMap["wg_default_subnet"] ?? "10.210.0.0/24";
    const startPos = parseInt(settingsMap["wg_device_ip_start"] ?? "100");
    wgAddress = allocateDeviceIp(usedAddresses, subnet, startPos);
  } else if (protocol === "xray") {
    // xray: generate UUID
    xrayUuid = uuidv4();
  } else if (protocol === "socks5") {
    socks5Username = generateRandomString(8);
    socks5Password = encrypt(generateRandomString(16));
  }

  const result = db
    .insert(devices)
    .values({
      name,
      protocol,
      wgPublicKey,
      wgPrivateKey,
      wgAddress,
      xrayUuid,
      socks5Username,
      socks5Password,
      lineId: lineId ?? null,
      remark: remark ?? null,
    })
    .returning({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgPublicKey: devices.wgPublicKey,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
      socks5Username: devices.socks5Username,
      lineId: devices.lineId,
      status: devices.status,
      remark: devices.remark,
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt,
    })
    .get();

  const entryNodeId = result.lineId ? getEntryNodeId(result.lineId) : null;

  // Allocate proxy port for the line if this is the first xray/socks5 device
  if (result.lineId && entryNodeId !== null && (protocol === "xray" || protocol === "socks5")) {
    const portField = protocol === "xray" ? "xrayPort" : "socks5Port";
    const line = db.select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port }).from(lines).where(eq(lines.id, result.lineId)).get();
    if (line && line[portField] === null) {
      const nodeRow = db.select({ xrayPort: nodes.xrayPort }).from(nodes).where(eq(nodes.id, entryNodeId)).get();
      const basePort = nodeRow?.xrayPort ?? getXrayDefaultPort();
      const port = allocateProxyPort(entryNodeId, basePort);
      db.update(lines).set({ [portField]: port }).where(eq(lines.id, result.lineId)).run();
    }
  }

  writeAuditLog({
    action: "create",
    targetType: "device",
    targetId: result.id,
    targetName: name,
    detail: `protocol=${protocol}`,
  });

  if (entryNodeId !== null) {
    db.update(nodes).set({ updatedAt: sql`(datetime('now'))` }).where(eq(nodes.id, entryNodeId)).run();
    sseManager.notifyNodePeerUpdate(entryNodeId);
  }

  return created(result);
}
