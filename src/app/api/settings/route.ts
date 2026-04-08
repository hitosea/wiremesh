import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET() {
  const rows = db.select().from(settings).all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return success(result);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (typeof body !== "object" || body === null) {
    return error("VALIDATION_ERROR", "请求体必须是对象");
  }
  // Merge incoming values with existing settings for validation
  const existingRows = db.select().from(settings).all();
  const merged: Record<string, string> = {};
  for (const row of existingRows) {
    merged[row.key] = row.value;
  }
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }

  // Validate: wg_default_port and tunnel_port_start must not overlap
  const wgPort = parseInt(merged["wg_default_port"] ?? "41820");
  const tunnelPortStart = parseInt(merged["tunnel_port_start"] ?? "41830");
  if (wgPort >= tunnelPortStart) {
    return error("VALIDATION_ERROR", `WireGuard 默认端口 (${wgPort}) 必须小于隧道端口起始值 (${tunnelPortStart})，否则会导致端口冲突`);
  }

  const changes: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    db.insert(settings)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date().toISOString() },
      })
      .run();
    changes.push(`${key}=${value}`);
  }
  writeAuditLog({
    action: "update",
    targetType: "settings",
    detail: changes.join(", "),
  });
  return success({ message: "设置已更新" });
}
