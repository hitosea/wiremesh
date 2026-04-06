import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lines, lineNodes, lineTunnels, nodes, settings, devices } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, like, count, and, SQL } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateTunnelSubnet, allocateTunnelPort } from "@/lib/ip-allocator";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");

  const conditions: SQL[] = [];
  if (search) conditions.push(like(lines.name, `%${search}%`));
  if (status) conditions.push(eq(lines.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db.select({ count: count() }).from(lines).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(lines)
    .where(where)
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  const result = rows.map((line) => {
    const lineNodeRows = db
      .select({
        hopOrder: lineNodes.hopOrder,
        role: lineNodes.role,
        nodeId: lineNodes.nodeId,
        nodeName: nodes.name,
      })
      .from(lineNodes)
      .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
      .where(eq(lineNodes.lineId, line.id))
      .orderBy(lineNodes.hopOrder)
      .all();
    return { ...line, nodes: lineNodeRows };
  });

  return paginated(result, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, nodeIds, tags, remark } = body;

  if (!name || !name.trim()) {
    return error("VALIDATION_ERROR", "name 为必填项");
  }
  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
    return error("VALIDATION_ERROR", "nodeIds 至少需要 2 个节点");
  }

  // Verify all nodes exist
  for (const nodeId of nodeIds) {
    const node = db
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .get();
    if (!node) {
      return error("VALIDATION_ERROR", `节点 ID ${nodeId} 不存在`);
    }
  }

  // Read settings
  const settingsRows = db.select().from(settings).all();
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) {
    settingsMap[row.key] = row.value;
  }
  const tunnelSubnet = settingsMap["tunnel_subnet"] ?? "10.211.0.0/16";
  const tunnelPortStart = parseInt(settingsMap["tunnel_port_start"] ?? "41830");

  // Insert line
  const line = db
    .insert(lines)
    .values({
      name: name.trim(),
      status: "active",
      tags: tags ?? null,
      remark: remark ?? null,
    })
    .returning()
    .get();

  // Insert line_nodes
  for (let i = 0; i < nodeIds.length; i++) {
    let role: string;
    if (i === 0) role = "entry";
    else if (i === nodeIds.length - 1) role = "exit";
    else role = "relay";

    db.insert(lineNodes)
      .values({
        lineId: line.id,
        nodeId: nodeIds[i],
        hopOrder: i,
        role,
      })
      .run();
  }

  // Read already used addresses and ports from line_tunnels to avoid conflicts
  const existingTunnels = db.select().from(lineTunnels).all();
  const usedAddresses: string[] = existingTunnels.flatMap((t) => [
    t.fromWgAddress,
    t.toWgAddress,
  ]);
  const usedPorts: number[] = existingTunnels.flatMap((t) => [
    t.fromWgPort,
    t.toWgPort,
  ]);

  // Create line_tunnels for each adjacent pair
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const fromNodeId = nodeIds[i];
    const toNodeId = nodeIds[i + 1];

    // Allocate /30 subnet
    const { fromAddress, toAddress } = allocateTunnelSubnet(
      usedAddresses,
      tunnelSubnet
    );

    // Allocate ports for both ends
    const fromPort = allocateTunnelPort(usedPorts, tunnelPortStart);
    usedPorts.push(fromPort);
    const toPort = allocateTunnelPort(usedPorts, tunnelPortStart);
    usedPorts.push(toPort);

    // Track allocated addresses
    usedAddresses.push(fromAddress, toAddress);

    // Generate key pairs
    const fromKeyPair = generateKeyPair();
    const toKeyPair = generateKeyPair();

    db.insert(lineTunnels)
      .values({
        lineId: line.id,
        hopIndex: i,
        fromNodeId,
        toNodeId,
        fromWgPrivateKey: encrypt(fromKeyPair.privateKey),
        fromWgPublicKey: fromKeyPair.publicKey,
        fromWgAddress: fromAddress,
        fromWgPort: fromPort,
        toWgPrivateKey: encrypt(toKeyPair.privateKey),
        toWgPublicKey: toKeyPair.publicKey,
        toWgAddress: toAddress,
        toWgPort: toPort,
      })
      .run();
  }

  writeAuditLog({
    action: "create",
    targetType: "line",
    targetId: line.id,
    targetName: name.trim(),
    detail: `nodes=${nodeIds.join(",")}`,
  });

  for (const nodeId of nodeIds) {
    sseManager.notifyNodeTunnelUpdate(nodeId);
  }

  return created(line);
}
