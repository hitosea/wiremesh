import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineBranches, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { and, eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

type Params = { params: Promise<{ id: string; branchId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, branchId } = await params;
  const lineId = parseInt(id);
  const bId = parseInt(branchId);
  if (isNaN(lineId)) return error("VALIDATION_ERROR", "validation.invalidLineId");
  if (isNaN(bId)) return error("VALIDATION_ERROR", "validation.invalidBranchId");

  const line = db
    .select({ id: lines.id, name: lines.name })
    .from(lines)
    .where(eq(lines.id, lineId))
    .get();
  if (!line) return error("NOT_FOUND", "notFound.line");

  const branch = db
    .select()
    .from(lineBranches)
    .where(and(eq(lineBranches.id, bId), eq(lineBranches.lineId, lineId)))
    .get();
  if (!branch) return error("NOT_FOUND", "notFound.branch");

  const body = await request.json();
  const { name } = body as { name?: string };

  if (typeof name !== "string" || !name.trim()) {
    return error("VALIDATION_ERROR", "validation.branchNameRequiredSimple");
  }

  const trimmed = name.trim();
  if (trimmed === branch.name) {
    return success(branch);
  }

  const updated = db
    .update(lineBranches)
    .set({ name: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(lineBranches.id, bId))
    .returning()
    .get();

  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: lineId,
    targetName: line.name,
    detail: `branch ${bId} rename: "${branch.name}" -> "${trimmed}"`,
  });

  return success(updated);
}
