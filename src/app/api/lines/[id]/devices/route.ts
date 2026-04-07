import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { computeDeviceStatus } from "@/lib/device-status";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  if (isNaN(lineId)) return error("VALIDATION_ERROR", "无效的线路 ID");

  const rows = db
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
      lastHandshake: devices.lastHandshake,
    })
    .from(devices)
    .where(eq(devices.lineId, lineId))
    .all();

  const data = rows.map((r) => ({
    ...r,
    status: computeDeviceStatus(r.lastHandshake, r.protocol),
  }));

  return success(data);
}
