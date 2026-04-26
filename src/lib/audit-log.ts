import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export function writeAuditLog(entry: {
  action: "create" | "update" | "delete";
  targetType: "node" | "device" | "line" | "filter" | "settings" | "subscription";
  targetId?: number;
  targetName?: string;
  detail?: string;
}) {
  db.insert(auditLogs)
    .values({
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      detail: entry.detail,
    })
    .run();
}
