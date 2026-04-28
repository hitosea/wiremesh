import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lineBranches, lines } from "@/lib/db/schema";
import { created, error } from "@/lib/api-response";
import { eq, sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import {
  buildAllocationState,
  getBranchDetail,
  getEntryNodeId,
  insertBranchTopology,
  notifyNodeIds,
  replaceBranchFilters,
  validateBranchInput,
  type BranchInput,
} from "@/lib/line-branch-manager";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id, 10);
  if (isNaN(lineId)) return error("VALIDATION_ERROR", "validation.invalidLineId");

  const line = db
    .select({ id: lines.id, name: lines.name })
    .from(lines)
    .where(eq(lines.id, lineId))
    .get();
  if (!line) return error("NOT_FOUND", "notFound.line");

  const entryNodeId = getEntryNodeId(lineId);
  if (entryNodeId === null) return error("VALIDATION_ERROR", "validation.entryNodeNotFound", { id: lineId });

  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return error("VALIDATION_ERROR", "validation.bodyMustBeObject");
  }
  if (Object.prototype.hasOwnProperty.call(body, "name") && typeof body.name !== "string") {
    return error("VALIDATION_ERROR", "validation.branchNameRequiredSimple");
  }
  if (!Array.isArray(body.nodeIds)) {
    return error("VALIDATION_ERROR", "validation.nodeIdsMustBeArray");
  }
  if (Object.prototype.hasOwnProperty.call(body, "filterIds") && !Array.isArray(body.filterIds)) {
    return error("VALIDATION_ERROR", "validation.filterIdsMustBeArray");
  }
  if (Object.prototype.hasOwnProperty.call(body, "isDefault") && typeof body.isDefault !== "boolean") {
    return error("VALIDATION_ERROR", "validation.isDefaultMustBeBoolean");
  }

  const input = body as Partial<BranchInput>;
  const branchInput: BranchInput = {
    name: typeof input.name === "string" ? input.name : "",
    isDefault: input.isDefault === true,
    nodeIds: input.nodeIds!.map(Number),
    filterIds: Array.isArray(input.filterIds) ? input.filterIds.map(Number) : [],
  };

  const validationError = validateBranchInput(branchInput, entryNodeId);
  if (validationError) {
    return error("VALIDATION_ERROR", validationError.message, validationError.params);
  }

  const existingBranches = db
    .select({ id: lineBranches.id, isDefault: lineBranches.isDefault })
    .from(lineBranches)
    .where(eq(lineBranches.lineId, lineId))
    .all();
  if (!branchInput.isDefault && existingBranches.length === 0) {
    return error("VALIDATION_ERROR", "validation.exactlyOneDefaultBranch");
  }

  let branchId = 0;
  const affectedNodeIds = new Set<number>([entryNodeId, ...branchInput.nodeIds]);
  const allocation = buildAllocationState([...affectedNodeIds]);

  db.transaction((tx) => {
    if (branchInput.isDefault) {
      tx.update(lineBranches)
        .set({ isDefault: false, updatedAt: sql`(datetime('now'))` })
        .where(eq(lineBranches.lineId, lineId))
        .run();
    }

    const branch = tx
      .insert(lineBranches)
      .values({
        lineId,
        name: branchInput.name.trim(),
        isDefault: branchInput.isDefault,
      })
      .returning({ id: lineBranches.id })
      .get();
    branchId = branch.id;

    insertBranchTopology(tx, lineId, branchId, entryNodeId, branchInput.nodeIds, allocation);
    replaceBranchFilters(tx, branchId, branchInput.isDefault, branchInput.filterIds);

    tx.update(lines).set({ updatedAt: sql`(datetime('now'))` }).where(eq(lines.id, lineId)).run();
  });

  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: lineId,
    targetName: line.name,
    detail: `branch create: ${branchInput.name.trim()} nodes=[${branchInput.nodeIds.join(",")}], filters=[${(branchInput.filterIds ?? []).join(",")}]`,
  });

  notifyNodeIds(affectedNodeIds);

  return created(getBranchDetail(branchId));
}
