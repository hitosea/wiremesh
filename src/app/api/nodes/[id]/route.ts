import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, ne, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { encrypt } from "@/lib/crypto";
import { generateRealityKeypair, generateShortId } from "@/lib/reality";
import { normalizeRealityDest } from "@/lib/reality-dest";
import { sseManager } from "@/lib/sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const node = db
    .select({
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
      status: nodes.status,
      errorMessage: nodes.errorMessage,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
    })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();

  if (!node) return error("NOT_FOUND", "notFound.node");
  return success(node);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const existing = db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.node");

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
    remark,
  } = body;

  // Check IP uniqueness if changed
  if (ip) {
    const ipConflict = db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.ip, ip), ne(nodes.id, nodeId)))
      .get();
    if (ipConflict) return error("CONFLICT", "conflict.ipExists");
  }

  const updateData: Partial<typeof nodes.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (ip !== undefined) updateData.ip = ip;
  if (domain !== undefined) updateData.domain = domain;
  if (port !== undefined) updateData.port = port;
  if (xrayEnabled !== undefined) updateData.xrayEnabled = xrayEnabled;
  if (xrayProtocol !== undefined) updateData.xrayProtocol = xrayProtocol;
  if (xrayTransport !== undefined) updateData.xrayTransport = xrayTransport;
  if (xrayPort !== undefined) updateData.xrayPort = xrayPort;
  if (remark !== undefined) updateData.remark = remark;

  // Auto-generate Reality keys when enabling Xray for the first time
  if (xrayEnabled === true) {
    const currentNode = db.select({ xrayConfig: nodes.xrayConfig, xrayEnabled: nodes.xrayEnabled }).from(nodes).where(eq(nodes.id, nodeId)).get();
    let needKeys = true;
    if (currentNode?.xrayConfig) {
      try {
        const parsed = JSON.parse(currentNode.xrayConfig);
        if (parsed.realityPublicKey) needKeys = false;
      } catch (e) {
        console.warn(`[nodes/${nodeId}] Failed to parse xrayConfig:`, e);
      }
    }
    if (needKeys) {
      const realityKeys = generateRealityKeypair();
      const shortId = generateShortId();
      const { realityDest, realityServerName } = normalizeRealityDest(body.realityDest);
      updateData.xrayConfig = JSON.stringify({
        realityPrivateKey: encrypt(realityKeys.privateKey),
        realityPublicKey: realityKeys.publicKey,
        realityShortId: shortId,
        realityDest,
        realityServerName,
      });
    } else if (body.realityDest !== undefined) {
      // Update dest/serverName without regenerating keys
      const parsed = JSON.parse(currentNode!.xrayConfig!);
      const normalized = normalizeRealityDest(body.realityDest);
      parsed.realityDest = normalized.realityDest;
      parsed.realityServerName = normalized.realityServerName;
      updateData.xrayConfig = JSON.stringify(parsed);
    }
    updateData.xrayProtocol = "vless";
    updateData.xrayTransport = "tcp";
  }

  const updated = db
    .update(nodes)
    .set(updateData)
    .where(eq(nodes.id, nodeId))
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
      status: nodes.status,
      errorMessage: nodes.errorMessage,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
    })
    .get();

  writeAuditLog({
    action: "update",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

  sseManager.notifyNodeConfigUpdate(nodeId);

  return success(updated);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const existing = db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();
  if (!existing) return error("NOT_FOUND", "notFound.node");

  db.delete(nodes).where(eq(nodes.id, nodeId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

  return success({ message: "节点已删除" });
}
