import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, devices, lines, nodeStatus } from "@/lib/db/schema";
import { success } from "@/lib/api-response";
import { eq, count, desc, sql, gt, or, isNull, lte } from "drizzle-orm";
import { computeDeviceStatus } from "@/lib/device-status";

export async function GET(request: NextRequest) {
  // Node counts
  const totalNodes = db.select({ count: count() }).from(nodes).get()?.count ?? 0;
  const onlineNodes =
    db.select({ count: count() }).from(nodes).where(eq(nodes.status, "online")).get()?.count ?? 0;
  const offlineNodes =
    db.select({ count: count() }).from(nodes).where(eq(nodes.status, "offline")).get()?.count ?? 0;
  const errorNodes =
    db.select({ count: count() }).from(nodes).where(eq(nodes.status, "error")).get()?.count ?? 0;

  // Device counts (status computed from lastHandshake)
  const totalDevices = db.select({ count: count() }).from(devices).get()?.count ?? 0;
  const deviceThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const onlineDevices =
    db.select({ count: count() }).from(devices).where(gt(devices.lastHandshake, deviceThreshold)).get()?.count ?? 0;
  const offlineDevices = totalDevices - onlineDevices;

  // Line counts
  const totalLines = db.select({ count: count() }).from(lines).get()?.count ?? 0;
  const activeLines =
    db.select({ count: count() }).from(lines).where(eq(lines.status, "active")).get()?.count ?? 0;
  const inactiveLines =
    db.select({ count: count() }).from(lines).where(eq(lines.status, "inactive")).get()?.count ?? 0;

  // Traffic: latest node_status per node (aggregate upload/download)
  const trafficRows = db
    .select({
      nodeId: nodeStatus.nodeId,
      uploadBytes: sql<number>`sum(${nodeStatus.uploadBytes})`,
      downloadBytes: sql<number>`sum(${nodeStatus.downloadBytes})`,
    })
    .from(nodeStatus)
    .groupBy(nodeStatus.nodeId)
    .all();

  // Join with node names for traffic display
  const trafficWithNames = trafficRows.map((row) => {
    const node = db
      .select({ name: nodes.name, ip: nodes.ip })
      .from(nodes)
      .where(eq(nodes.id, row.nodeId))
      .get();
    return {
      nodeId: row.nodeId,
      nodeName: node?.name ?? `节点 ${row.nodeId}`,
      nodeIp: node?.ip ?? "",
      uploadBytes: row.uploadBytes ?? 0,
      downloadBytes: row.downloadBytes ?? 0,
    };
  });

  const totalUploadBytes = trafficWithNames.reduce((sum, r) => sum + r.uploadBytes, 0);
  const totalDownloadBytes = trafficWithNames.reduce((sum, r) => sum + r.downloadBytes, 0);

  // Recent nodes (top 10)
  const recentNodes = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      wgAddress: nodes.wgAddress,
      status: nodes.status,
      updatedAt: nodes.updatedAt,
    })
    .from(nodes)
    .orderBy(desc(nodes.updatedAt))
    .limit(10)
    .all();

  // Recent devices (top 10)
  const recentDevicesRaw = db
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgAddress: devices.wgAddress,
      lastHandshake: devices.lastHandshake,
      lineId: devices.lineId,
      updatedAt: devices.updatedAt,
    })
    .from(devices)
    .orderBy(desc(devices.updatedAt))
    .limit(10)
    .all();
  const recentDevices = recentDevicesRaw.map((d) => ({
    ...d,
    status: computeDeviceStatus(d.lastHandshake, d.protocol),
  }));

  return success({
    nodes: {
      total: totalNodes,
      online: onlineNodes,
      offline: offlineNodes,
      error: errorNodes,
    },
    devices: {
      total: totalDevices,
      online: onlineDevices,
      offline: offlineDevices,
    },
    lines: {
      total: totalLines,
      active: activeLines,
      inactive: inactiveLines,
    },
    traffic: {
      totalUploadBytes,
      totalDownloadBytes,
      nodes: trafficWithNames,
    },
    recentNodes,
    recentDevices,
  });
}
