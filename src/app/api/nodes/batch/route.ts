import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { sseManager } from "@/lib/sse-manager";

export async function POST(request: Request) {
  const body = await request.json();
  const { action, ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error("VALIDATION_ERROR", "validation.selectAtLeastOneNode");
  }

  if (action === "delete") {
    const existing = db
      .select({ id: nodes.id, name: nodes.name })
      .from(nodes)
      .where(inArray(nodes.id, ids))
      .all();

    let onlineCount = 0;
    let offlineCount = 0;

    for (const node of existing) {
      db.update(nodes)
        .set({ pendingDelete: true, updatedAt: new Date().toISOString() })
        .where(inArray(nodes.id, [node.id]))
        .run();

      const sent = sseManager.sendEvent(node.id, "node_delete");
      if (sent) {
        onlineCount++;
      } else {
        offlineCount++;
      }
    }

    writeAuditLog({
      action: "delete",
      targetType: "node",
      targetId: 0,
      targetName: existing.map((n) => n.name).join(", "),
      detail: `批量删除 ${existing.length} 个节点（在线 ${onlineCount}，离线 ${offlineCount}）`,
    });

    return success({ deleted: existing.length, online: onlineCount, offline: offlineCount });
  }

  return error("VALIDATION_ERROR", "validation.invalidActionType");
}
