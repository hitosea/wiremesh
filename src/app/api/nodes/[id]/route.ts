import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, ne, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "无效的节点 ID");

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
      tags: nodes.tags,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
    })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();

  if (!node) return error("NOT_FOUND", "节点不存在");
  return success(node);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "无效的节点 ID");

  const existing = db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();
  if (!existing) return error("NOT_FOUND", "节点不存在");

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
    tags,
    remark,
  } = body;

  // Check IP uniqueness if changed
  if (ip) {
    const ipConflict = db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.ip, ip), ne(nodes.id, nodeId)))
      .get();
    if (ipConflict) return error("CONFLICT", "该 IP 地址已存在");
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
  if (xrayConfig !== undefined) updateData.xrayConfig = xrayConfig;
  if (tags !== undefined) updateData.tags = tags;
  if (remark !== undefined) updateData.remark = remark;

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
      tags: nodes.tags,
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
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "无效的节点 ID");

  const existing = db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();
  if (!existing) return error("NOT_FOUND", "节点不存在");

  db.delete(nodes).where(eq(nodes.id, nodeId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

  return success({ message: "节点已删除" });
}
