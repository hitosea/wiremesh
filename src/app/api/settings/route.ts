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

  // --- Validation ---
  const validationErrors: string[] = [];

  const isValidPort = (v: string) => { const n = parseInt(v); return !isNaN(n) && n >= 1 && n <= 65535; };
  const isValidIP = (v: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((o) => parseInt(o) >= 0 && parseInt(o) <= 255);
  const isValidCIDR = (v: string) => { const [ip, mask] = v.split("/"); return isValidIP(ip) && parseInt(mask) >= 0 && parseInt(mask) <= 32; };
  const isPositiveInt = (v: string) => { const n = parseInt(v); return !isNaN(n) && n > 0 && String(n) === v; };

  if (merged["wg_default_port"] && !isValidPort(merged["wg_default_port"])) {
    validationErrors.push("WireGuard 默认端口必须是 1-65535 的整数");
  }
  if (merged["wg_default_subnet"] && !isValidCIDR(merged["wg_default_subnet"])) {
    validationErrors.push("默认子网格式不正确（如 10.210.0.0/24）");
  }
  if (merged["wg_default_dns"] && !isValidIP(merged["wg_default_dns"])) {
    validationErrors.push("默认 DNS 必须是合法的 IP 地址");
  }

  const nodeStart = parseInt(merged["wg_node_ip_start"] ?? "1");
  const deviceStart = parseInt(merged["wg_device_ip_start"] ?? "100");
  if (merged["wg_node_ip_start"] && (!isPositiveInt(merged["wg_node_ip_start"]) || nodeStart < 1 || nodeStart > 254)) {
    validationErrors.push("节点 IP 起始位必须是 1-254 的整数");
  }
  if (merged["wg_device_ip_start"] && (!isPositiveInt(merged["wg_device_ip_start"]) || deviceStart < 1 || deviceStart > 254)) {
    validationErrors.push("设备 IP 起始位必须是 1-254 的整数");
  }
  if (nodeStart >= deviceStart) {
    validationErrors.push(`节点 IP 起始位 (${nodeStart}) 必须小于设备 IP 起始位 (${deviceStart})，否则 IP 会重叠`);
  }

  if (merged["tunnel_subnet"] && !isValidCIDR(merged["tunnel_subnet"])) {
    validationErrors.push("隧道子网格式不正确（如 10.211.0.0/16）");
  }

  const wgPort = parseInt(merged["wg_default_port"] ?? "41820");
  const tunnelPortStart = parseInt(merged["tunnel_port_start"] ?? "41830");
  if (merged["tunnel_port_start"] && !isValidPort(merged["tunnel_port_start"])) {
    validationErrors.push("隧道端口起始值必须是 1-65535 的整数");
  }
  if (wgPort >= tunnelPortStart) {
    validationErrors.push(`WireGuard 默认端口 (${wgPort}) 必须小于隧道端口起始值 (${tunnelPortStart})`);
  }

  const syncInterval = parseInt(merged["filter_sync_interval"] ?? "86400");
  if (merged["filter_sync_interval"] && (!isPositiveInt(merged["filter_sync_interval"]) || syncInterval < 60)) {
    validationErrors.push("同步间隔必须是不小于 60 的整数");
  }

  if (merged["dns_upstream"]) {
    const ips = merged["dns_upstream"].split(",").map((s) => s.trim());
    if (ips.length === 0 || ips.some((ip) => !isValidIP(ip))) {
      validationErrors.push("DNS 上游服务器必须是逗号分隔的合法 IP 地址");
    }
  }

  if (validationErrors.length > 0) {
    return error("VALIDATION_ERROR", validationErrors.join("；"));
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
