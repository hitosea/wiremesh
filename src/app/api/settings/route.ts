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
