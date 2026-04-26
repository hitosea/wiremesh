import { db } from "@/lib/db";
import { devices, lineNodes, nodes, lines } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import type { DeviceContext, EntryNodeContext, DeviceProtocol } from "./types";

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
      xrayPort: nodes.xrayPort,
      xrayTransport: nodes.xrayTransport,
      xrayTlsDomain: nodes.xrayTlsDomain,
      xrayWsPath: nodes.xrayWsPath,
      xrayConfig: nodes.xrayConfig,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(and(eq(lineNodes.lineId, lineId), eq(lineNodes.hopOrder, 0)))
    .get();

  if (!row) return null;

  let realityPublicKey: string | null = null;
  let realityShortId: string | null = null;
  let realityServerName: string | null = null;
  if (row.xrayConfig) {
    try {
      const parsed = JSON.parse(row.xrayConfig);
      realityPublicKey = parsed.realityPublicKey ?? null;
      realityShortId = parsed.realityShortId ?? null;
      realityServerName = parsed.realityServerName ?? null;
    } catch {
      // ignore — entries without parseable xrayConfig will still produce
      // wireguard / socks5 entries; xray entries will be skipped upstream
    }
  }

  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    domain: row.domain,
    wgPort: row.port,
    wgPublicKey: row.wgPublicKey,
    wgAddress: stripCidr(row.wgAddress),
    xrayPort: row.xrayPort,
    xrayTransport: row.xrayTransport,
    xrayTlsDomain: row.xrayTlsDomain,
    xrayWsPath: row.xrayWsPath,
    realityPublicKey,
    realityShortId,
    realityServerName,
  };
}

function loadLinePorts(lineId: number) {
  return db
    .select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port })
    .from(lines)
    .where(eq(lines.id, lineId))
    .get();
}

function buildDeviceContext(device: DeviceRow): DeviceContext | null {
  if (!device.lineId) return null;
  const protocol = device.protocol as DeviceProtocol;
  const entry = loadEntryNode(device.lineId);
  if (!entry) return null;
  const linePorts = loadLinePorts(device.lineId);

  const ctx: DeviceContext = {
    id: device.id,
    name: device.name,
    remark: device.remark ?? null,
    protocol,
    lineId: device.lineId,
    lineXrayPort: linePorts?.xrayPort ?? null,
    lineSocks5Port: linePorts?.socks5Port ?? null,
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
  } else if (protocol === "xray") {
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
