import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { nodes, settings } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { DEFAULT_PROXY_PORT } from "@/lib/proxy-port";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, or, like, count, and, SQL } from "drizzle-orm";
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
      xrayEnabled: nodes.xrayEnabled,
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

  return paginated(rows, {
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
    xrayEnabled,
    xrayProtocol,
    xrayTransport,
    xrayPort,
    xrayConfig,
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

  // Generate Reality keypair if Xray is enabled
  let resolvedXrayConfig = xrayConfig ?? null;
  if (xrayEnabled) {
    const realityKeys = generateRealityKeypair();
    const shortId = generateShortId();
    const { realityDest, realityServerName } = normalizeRealityDest(body.realityDest);
    resolvedXrayConfig = JSON.stringify({
      realityPrivateKey: encrypt(realityKeys.privateKey),
      realityPublicKey: realityKeys.publicKey,
      realityShortId: shortId,
      realityDest,
      realityServerName,
    });
  }

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
      xrayEnabled: xrayEnabled ?? false,
      xrayProtocol: xrayEnabled ? "vless" : null,
      xrayTransport: xrayEnabled ? "tcp" : null,
      xrayPort: xrayEnabled ? (xrayPort ?? parseInt(settingsMap["xray_default_port"] ?? String(DEFAULT_PROXY_PORT))) : null,
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
      xrayEnabled: nodes.xrayEnabled,
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
