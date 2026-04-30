import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { nodes, lineNodes, devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq, ne, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { encrypt } from "@/lib/crypto";
import { generateRealityKeypair, generateShortId } from "@/lib/reality";
import { normalizeRealityDest } from "@/lib/reality-dest";
import { sseManager } from "@/lib/sse-manager";
import { getNodePorts } from "@/lib/node-ports";
import { deleteSource as deleteLatencySource } from "@/lib/node-latency-matrix";
import {
  getNodeProtocols,
  enableNodeProtocol,
  setNodeProtocolConfig,
  disableNodeProtocol,
  releaseLineProtocol,
} from "@/lib/db/protocols";

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
      xrayBasePort: nodes.xrayBasePort,
      agentToken: nodes.agentToken,
      wgPublicKey: nodes.wgPublicKey,
      wgAddress: nodes.wgAddress,
      status: nodes.status,
      errorMessage: nodes.errorMessage,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
      agentVersion: nodes.agentVersion,
      xrayVersion: nodes.xrayVersion,
      upgradeTriggeredAt: nodes.upgradeTriggeredAt,
      xrayUpgradeTriggeredAt: nodes.xrayUpgradeTriggeredAt,
      tunnelPortBlacklist: nodes.tunnelPortBlacklist,
    })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();

  if (!node) return error("NOT_FOUND", "notFound.node");

  const npRows = getNodeProtocols(db, nodeId);
  const np = Object.fromEntries(npRows.map(r => [r.protocol, JSON.parse(r.config)]));

  const protocols = {
    xrayReality: np["xray-reality"]
      ? {
          realityDest:       np["xray-reality"].realityDest,
          realityPublicKey:  np["xray-reality"].realityPublicKey,
          realityShortId:    np["xray-reality"].realityShortId,
          realityServerName: np["xray-reality"].realityServerName,
        }
      : null,
    xrayWsTls: np["xray-wstls"]
      ? {
          tlsDomain: np["xray-wstls"].tlsDomain,
          certMode:  np["xray-wstls"].certMode,
          wsPath:    np["xray-wstls"].wsPath,
          hasCert:   !!np["xray-wstls"].tlsCert,
        }
      : null,
  };

  const ports = getNodePorts(node.id, node.port);
  return success({ ...node, protocols, ports });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const existing = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      domain: nodes.domain,
    })
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
    externalInterface,
    remark,
    tunnelPortBlacklist,
  } = body;

  // xrayBasePort: null = clear override; undefined = no change; number = set override
  let xrayBasePort: number | null | undefined = undefined;
  if (body.xrayBasePort !== undefined) {
    if (body.xrayBasePort === null || body.xrayBasePort === "") {
      xrayBasePort = null;
    } else {
      const parsed = parseInt(String(body.xrayBasePort), 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        return error("VALIDATION_ERROR", "validation.xrayBasePortInvalid");
      }
      xrayBasePort = parsed;
    }
  }

  // Check IP uniqueness if changed (exclude soft-deleted nodes)
  if (ip) {
    const ipConflict = db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.ip, ip), ne(nodes.id, nodeId), eq(nodes.pendingDelete, false)))
      .get();
    if (ipConflict) return error("CONFLICT", "conflict.ipExists");
  }

  // --- Protocol handling ---

  const currentProtocols = getNodeProtocols(db, nodeId);
  const hasReality = currentProtocols.some(p => p.protocol === "xray-reality");
  const hasWsTls   = currentProtocols.some(p => p.protocol === "xray-wstls");

  // Request body shape:
  //   protocols?: {
  //     xrayReality?: { realityDest?: string } | null,
  //     xrayWsTls?:   { tlsDomain: string, certMode: "auto"|"manual", tlsCert?: string, tlsKey?: string } | null,
  //   }
  //
  // Semantics: undefined = "no change"; null = "disable"; object = "enable or update".
  const reqProtocols = body.protocols as
    | { xrayReality?: { realityDest?: string } | null;
        xrayWsTls?:   { tlsDomain: string; certMode: "auto" | "manual"; tlsCert?: string; tlsKey?: string } | null }
    | undefined;

  const reqReality = reqProtocols?.xrayReality;
  const reqWsTls   = reqProtocols?.xrayWsTls;

  // Validate "at least one Xray transport remains" (only when protocols are being changed)
  if (reqProtocols !== undefined) {
    const willHaveReality = reqReality === null ? false : (reqReality !== undefined ? true : hasReality);
    const willHaveWsTls   = reqWsTls   === null ? false : (reqWsTls   !== undefined ? true : hasWsTls);
    if (!willHaveReality && !willHaveWsTls) {
      return error("VALIDATION_ERROR", "validation.xrayTransportRequired");
    }
  }

  // Validate WS+TLS domain when enabling
  if (reqWsTls && !hasWsTls && !reqWsTls.tlsDomain?.trim()) {
    return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
  }

  // Helper: find devices that depend on a transport on lines where this node is entry
  function findBlockingDevices(deviceProtocol: "xray-reality" | "xray-wstls") {
    return db.select({
      id: devices.id, name: devices.name, lineId: devices.lineId,
    }).from(devices)
      .innerJoin(lineNodes, eq(lineNodes.lineId, devices.lineId))
      .where(and(
        eq(devices.protocol, deviceProtocol),
        eq(lineNodes.nodeId, nodeId),
        eq(lineNodes.role, "entry"),
      ))
      .all();
  }

  // Helper: list all line ids where this node is the entry
  function entryLineIds() {
    return db.select({ id: lineNodes.lineId }).from(lineNodes)
      .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.role, "entry")))
      .all();
  }

  // Cascade checks before entering transaction
  if (reqReality === null && hasReality) {
    const blockers = findBlockingDevices("xray-reality");
    if (blockers.length > 0) {
      return error("CONFLICT", "validation.xrayTransportInUse", { transport: "reality" }, { devices: blockers });
    }
  }
  if (reqWsTls === null && hasWsTls) {
    const blockers = findBlockingDevices("xray-wstls");
    if (blockers.length > 0) {
      return error("CONFLICT", "validation.xrayTransportInUse", { transport: "ws-tls" }, { devices: blockers });
    }
  }

  // --- Build non-xray updateData ---
  const updateData: Partial<typeof nodes.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (name !== undefined) updateData.name = name;
  if (ip !== undefined) updateData.ip = ip;
  if (domain !== undefined) updateData.domain = domain;
  if (port !== undefined) updateData.port = port;
  if (externalInterface !== undefined) updateData.externalInterface = externalInterface;
  if (remark !== undefined) updateData.remark = remark;
  if (tunnelPortBlacklist !== undefined) updateData.tunnelPortBlacklist = tunnelPortBlacklist;
  if (xrayBasePort !== undefined) updateData.xrayBasePort = xrayBasePort;

  // --- Apply non-xray update ---
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
      status: nodes.status,
      errorMessage: nodes.errorMessage,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
    })
    .get();

  // --- Protocol mutations (in transaction) ---
  if (reqProtocols !== undefined) {
    db.transaction((tx) => {
      // Disable Reality
      if (reqReality === null && hasReality) {
        for (const { id: lid } of entryLineIds()) releaseLineProtocol(tx, lid, "xray-reality");
        disableNodeProtocol(tx, nodeId, "xray-reality");
      }

      // Disable WS+TLS
      if (reqWsTls === null && hasWsTls) {
        for (const { id: lid } of entryLineIds()) releaseLineProtocol(tx, lid, "xray-wstls");
        disableNodeProtocol(tx, nodeId, "xray-wstls");
      }

      // Enable Reality (was off, now on)
      if (reqReality && !hasReality) {
        const kp = generateRealityKeypair();
        const shortId = generateShortId();
        const { realityDest, realityServerName } = normalizeRealityDest(reqReality.realityDest);
        enableNodeProtocol(tx, nodeId, "xray-reality", {
          realityPrivateKey: encrypt(kp.privateKey),
          realityPublicKey: kp.publicKey,
          realityShortId: shortId,
          realityDest,
          realityServerName,
        });
      }

      // Modify Reality (was on, still on)
      if (reqReality && hasReality) {
        const cur = JSON.parse(currentProtocols.find(p => p.protocol === "xray-reality")!.config);
        if (reqReality.realityDest !== undefined && reqReality.realityDest !== cur.realityDest) {
          const { realityDest, realityServerName } = normalizeRealityDest(reqReality.realityDest);
          setNodeProtocolConfig(tx, nodeId, "xray-reality", {
            ...cur, realityDest, realityServerName,
          });
        }
      }

      // Enable WS+TLS (was off, now on)
      if (reqWsTls && !hasWsTls) {
        enableNodeProtocol(tx, nodeId, "xray-wstls", {
          wsPath: "/" + randomBytes(4).toString("hex"),
          tlsDomain: reqWsTls.tlsDomain.trim(),
          certMode: reqWsTls.certMode,
          tlsCert: reqWsTls.certMode === "manual" ? (reqWsTls.tlsCert ?? null) : null,
          tlsKey:  reqWsTls.certMode === "manual" && reqWsTls.tlsKey ? encrypt(reqWsTls.tlsKey) : null,
        });
      }

      // Modify WS+TLS (was on, still on)
      if (reqWsTls && hasWsTls) {
        const cur = JSON.parse(currentProtocols.find(p => p.protocol === "xray-wstls")!.config);
        setNodeProtocolConfig(tx, nodeId, "xray-wstls", {
          ...cur,
          tlsDomain: reqWsTls.tlsDomain.trim(),
          certMode:  reqWsTls.certMode,
          tlsCert:   reqWsTls.certMode === "manual" ? (reqWsTls.tlsCert ?? cur.tlsCert) : null,
          tlsKey:    reqWsTls.certMode === "manual"
                       ? (reqWsTls.tlsKey ? encrypt(reqWsTls.tlsKey) : cur.tlsKey)
                       : null,
        });
      }
    });
  }

  writeAuditLog({
    action: "update",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

  sseManager.notifyNodeConfigUpdate(nodeId);

  // When a node's address (ip/domain) changes, every other agent's tunnel
  // peerAddress and mesh ping target for this node go stale. Notify all so
  // wm-tunN reapplies the new endpoint and the mesh probe targets refresh.
  const ipChanged = ip !== undefined && ip !== existing.ip;
  const domainChanged = domain !== undefined && (domain || null) !== (existing.domain || null);
  if (ipChanged || domainChanged) {
    sseManager.notifyAllConfigUpdate(nodeId);
  }

  return success(updated);
}

export async function PATCH(request: NextRequest, { params }: Params) {
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
  const updateData: Partial<typeof nodes.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.tunnelPortBlacklist !== undefined) {
    updateData.tunnelPortBlacklist = String(body.tunnelPortBlacklist);
  }

  const updated = db
    .update(nodes)
    .set(updateData)
    .where(eq(nodes.id, nodeId))
    .returning({ id: nodes.id, tunnelPortBlacklist: nodes.tunnelPortBlacklist })
    .get();

  writeAuditLog({
    action: "update",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

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

  // Mark as pending delete (keep record for agent to pull config and see pending_delete)
  db.update(nodes)
    .set({ pendingDelete: true, updatedAt: new Date().toISOString() })
    .where(eq(nodes.id, nodeId))
    .run();

  // Try to notify agent via SSE
  const sent = sseManager.sendEvent(nodeId, "node_delete");

  // Other agents need to drop the deleted node from their mesh peer list so
  // they stop pinging it.
  sseManager.notifyAllConfigUpdate(nodeId);
  deleteLatencySource(nodeId);

  writeAuditLog({
    action: "delete",
    targetType: "node",
    targetId: nodeId,
    targetName: existing.name,
  });

  if (sent) {
    return success({ message: "nodes.deleteRemoteUninstall" });
  } else {
    return success({ message: "nodes.deleteOfflinePending" });
  }
}
