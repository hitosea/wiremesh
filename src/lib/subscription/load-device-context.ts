import { db } from "@/lib/db";
import { devices, lineNodes, nodes } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getNodeProtocol, getLineProtocolPort } from "@/lib/db/protocols";
import type { DeviceProtocol } from "@/lib/protocols";
import type { DeviceContext, EntryNodeContext } from "./types";

type DeviceRow = typeof devices.$inferSelect;

function stripCidr(addr: string | null): string {
  return (addr ?? "").split("/")[0];
}

function loadEntryNode(lineId: number): EntryNodeContext | null {
  const row = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      domain: nodes.domain,
      port: nodes.port,
      wgPublicKey: nodes.wgPublicKey,
      wgAddress: nodes.wgAddress,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.hopOrder, 0)))
    .get();

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    domain: row.domain,
    wgPort: row.port,
    wgPublicKey: row.wgPublicKey,
    wgAddress: stripCidr(row.wgAddress),
  };
}

function buildDeviceContext(device: DeviceRow): DeviceContext | null {
  if (!device.lineId) return null;
  const protocol = device.protocol as DeviceProtocol;
  const entry = loadEntryNode(device.lineId);
  if (!entry) return null;

  const linePort = getLineProtocolPort(db, device.lineId, protocol);

  // Populate per-transport fields on entry
  if (protocol === "xray-reality") {
    const np = getNodeProtocol(db, entry.id, "xray-reality");
    if (!np) return null;
    const cfg = JSON.parse(np.config) as {
      realityPublicKey?: string;
      realityShortId?: string;
      realityDest?: string;
      realityServerName?: string;
    };
    entry.xrayReality = {
      publicKey: cfg.realityPublicKey ?? "",
      shortId: cfg.realityShortId ?? "",
      dest: cfg.realityDest ?? "",
      serverName: cfg.realityServerName ?? "www.microsoft.com",
    };
  }

  if (protocol === "xray-wstls") {
    const np = getNodeProtocol(db, entry.id, "xray-wstls");
    if (!np) return null;
    const cfg = JSON.parse(np.config) as {
      wsPath?: string;
      tlsDomain?: string;
    };
    entry.xrayWsTls = {
      wsPath: cfg.wsPath ?? "/",
      tlsDomain: cfg.tlsDomain ?? entry.domain ?? entry.ip,
    };
  }

  const ctx: DeviceContext = {
    id: device.id,
    name: device.name,
    remark: device.remark ?? null,
    protocol,
    lineId: device.lineId,
    linePort,
    entry,
  };

  if (protocol === "wireguard") {
    if (!device.wgPrivateKey || !device.wgPublicKey || !device.wgAddress) return null;
    let privateKey: string;
    try {
      privateKey = decrypt(device.wgPrivateKey);
    } catch {
      return null;
    }
    ctx.wg = {
      privateKey,
      publicKey: device.wgPublicKey,
      address: device.wgAddress,
      addressIp: stripCidr(device.wgAddress),
    };
  } else if (protocol === "xray-reality" || protocol === "xray-wstls") {
    if (!device.xrayUuid) return null;
    ctx.xray = { uuid: device.xrayUuid };
  } else if (protocol === "socks5") {
    if (!device.socks5Username || !device.socks5Password) return null;
    let password: string;
    try {
      password = decrypt(device.socks5Password);
    } catch {
      return null;
    }
    ctx.socks5 = { username: device.socks5Username, password };
  } else {
    return null;
  }

  return ctx;
}

export function loadDeviceContexts(deviceIds: number[]): DeviceContext[] {
  if (deviceIds.length === 0) return [];
  const rows = db
    .select()
    .from(devices)
    .where(inArray(devices.id, deviceIds))
    .all();

  // Preserve input order so groups have stable proxy ordering.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: DeviceContext[] = [];
  for (const id of deviceIds) {
    const row = byId.get(id);
    if (!row) continue;
    const ctx = buildDeviceContext(row);
    if (ctx) out.push(ctx);
  }
  return out;
}
