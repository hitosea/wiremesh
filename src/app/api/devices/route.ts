import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { devices, settings, nodes, lineNodes } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, or, like, count, and, gt, lte, isNull, SQL } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateDeviceIp } from "@/lib/ip-allocator";
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
      tags: devices.tags,
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
    status: computeDeviceStatus(row.lastHandshake, row.protocol),
  }));

  return paginated(data, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, protocol, lineId, tags, remark } = body;

  if (!name) {
    return error("VALIDATION_ERROR", "name 为必填项");
  }
  if (!protocol || !["wireguard", "xray"].includes(protocol)) {
    return error("VALIDATION_ERROR", "protocol 必须为 wireguard 或 xray");
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
  } else {
    // xray: generate UUID
    xrayUuid = uuidv4();
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
      lineId: lineId ?? null,
      tags: tags ?? null,
      remark: remark ?? null,
    })
    .returning({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgPublicKey: devices.wgPublicKey,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
      lineId: devices.lineId,
      status: devices.status,
      tags: devices.tags,
      remark: devices.remark,
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt,
    })
    .get();

  writeAuditLog({
    action: "create",
    targetType: "device",
    targetId: result.id,
    targetName: name,
    detail: `protocol=${protocol}`,
  });

  if (result.lineId) {
    const entryNodeId = getEntryNodeId(result.lineId);
    if (entryNodeId !== null) {
      sseManager.notifyNodePeerUpdate(entryNodeId);
    }
  }

  return created(result);
}
