import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

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

    db.delete(nodes).where(inArray(nodes.id, ids)).run();

    for (const node of existing) {
      writeAuditLog({
        action: "delete",
        targetType: "node",
        targetId: node.id,
        targetName: node.name,
        detail: "批量删除",
      });
    }

    return success({ message: `已删除 ${existing.length} 个节点` });
  }

  return error("VALIDATION_ERROR", "validation.invalidActionType");
}
