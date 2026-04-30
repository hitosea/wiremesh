import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { nodeProtocols, lineProtocols, lineNodes, settings, nodes } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type { DeviceProtocol } from "@/lib/protocols";

type DB = BetterSQLite3Database<typeof schema>;

export function getNodeProtocols(db: DB, nodeId: number) {
  return db.select().from(nodeProtocols).where(eq(nodeProtocols.nodeId, nodeId)).all();
}

export function getNodeProtocol(db: DB, nodeId: number, protocol: DeviceProtocol) {
  return db.select().from(nodeProtocols)
    .where(and(eq(nodeProtocols.nodeId, nodeId), eq(nodeProtocols.protocol, protocol)))
    .get();
}

/**
 * Insert a new node_protocols row.
 * Throws SQLITE_CONSTRAINT if (nodeId, protocol) already exists.
 * Callers must check with `getNodeProtocol` first if uncertain.
 */
export function enableNodeProtocol(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
  config: Record<string, unknown>,
) {
  db.insert(nodeProtocols)
    .values({ nodeId, protocol, config: JSON.stringify(config) })
    .run();
}

export function setNodeProtocolConfig(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
  config: Record<string, unknown>,
) {
  db.update(nodeProtocols)
    .set({ config: JSON.stringify(config), updatedAt: new Date().toISOString() })
    .where(and(eq(nodeProtocols.nodeId, nodeId), eq(nodeProtocols.protocol, protocol)))
    .run();
}

export function disableNodeProtocol(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
) {
  db.delete(nodeProtocols)
    .where(and(eq(nodeProtocols.nodeId, nodeId), eq(nodeProtocols.protocol, protocol)))
    .run();
}

export function ensureLineProtocol(
  db: DB,
  lineId: number,
  protocol: DeviceProtocol,
  opts: { startPort: number },
): number | null {
  const existing = db.select().from(lineProtocols)
    .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, protocol)))
    .get();
  if (existing) return existing.port ?? null;

  const allocatePort = protocol !== "wireguard";
  let port: number | null = null;
  if (allocatePort) {
    // Ports are bound on the line's entry node. Every (line, protocol) pair
    // whose entry is the same node draws from the same port pool, regardless
    // of protocol — Xray and SOCKS5 both bind on the entry node and must not
    // collide with each other or with other lines on that node.
    const entryNodeId = getEntryNodeIdForLine(db, lineId);
    const usedRows = entryNodeId == null
      ? db.select({ port: lineProtocols.port }).from(lineProtocols).all()
      : db.select({ port: lineProtocols.port })
          .from(lineProtocols)
          .innerJoin(lineNodes, and(
            eq(lineNodes.lineId, lineProtocols.lineId),
            eq(lineNodes.role, "entry"),
            eq(lineNodes.nodeId, entryNodeId),
          ))
          .all();
    const used = new Set(usedRows.map(r => r.port).filter((p): p is number => p !== null));
    let candidate = opts.startPort;
    while (used.has(candidate)) candidate++;
    port = candidate;
  }

  db.insert(lineProtocols)
    .values({ lineId, protocol, port })
    .run();
  return port;
}

export function releaseLineProtocol(
  db: DB,
  lineId: number,
  protocol: DeviceProtocol,
) {
  db.delete(lineProtocols)
    .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, protocol)))
    .run();
}

export function getLineProtocols(db: DB, lineId: number) {
  return db.select().from(lineProtocols).where(eq(lineProtocols.lineId, lineId)).all();
}

export function getLineProtocolPort(
  db: DB,
  lineId: number,
  protocol: DeviceProtocol,
): number | null {
  const row = db.select({ port: lineProtocols.port }).from(lineProtocols)
    .where(and(eq(lineProtocols.lineId, lineId), eq(lineProtocols.protocol, protocol)))
    .get();
  return row?.port ?? null;
}

export function isProtocolSupportedByEntryNode(
  db: DB,
  nodeId: number,
  protocol: DeviceProtocol,
): boolean {
  const row = getNodeProtocol(db, nodeId, protocol);
  return row != null;
}

export function getEntryNodeIdForLine(db: DB, lineId: number): number | null {
  const row = db.select({ nodeId: lineNodes.nodeId }).from(lineNodes)
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.role, "entry")))
    .get();
  return row?.nodeId ?? null;
}

const DEFAULT_XRAY_BASE_PORT = 41443;

export function getDefaultProxyBasePort(db: DB): number {
  const row = db.select().from(settings).where(eq(settings.key, "xray_default_port")).get();
  if (!row) return DEFAULT_XRAY_BASE_PORT;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_XRAY_BASE_PORT;
}

/**
 * Resolve the port-allocation start point for a line.
 * Looks up the entry node's per-node `xrayBasePort`; falls back to the system default
 * `xray_default_port` setting if the node has no override.
 */
export function getStartPortForLine(db: DB, lineId: number): number {
  const entryNodeId = getEntryNodeIdForLine(db, lineId);
  if (entryNodeId == null) return getDefaultProxyBasePort(db);

  const row = db.select({ xrayBasePort: nodes.xrayBasePort }).from(nodes)
    .where(eq(nodes.id, entryNodeId))
    .get();
  if (row?.xrayBasePort != null) return row.xrayBasePort;

  return getDefaultProxyBasePort(db);
}
