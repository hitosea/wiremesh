import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { branchFilters, lineBranches, lineNodes, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { and, eq, sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import {
  buildAllocationState,
  getBranchDetail,
  getBranchNonEntryParticipantNodeIds,
  getEntryNodeId,
  getLineParticipantNodeIds,
  normalizeLineTunnelHopIndexes,
  notifyNodeIds,
  replaceBranchFilters,
  replaceBranchTopology,
  validateBranchInput,
  type BranchInput,
} from "@/lib/line-branch-manager";

type Params = { params: Promise<{ id: string; branchId: string }> };

function sameNumberArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, branchId } = await params;
  const lineId = parseInt(id, 10);
  const bId = parseInt(branchId, 10);
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

  const entryNodeId = getEntryNodeId(lineId);
  if (entryNodeId === null) return error("VALIDATION_ERROR", "validation.entryNodeNotFound", { id: lineId });

  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return error("VALIDATION_ERROR", "validation.bodyMustBeObject");
  }
  const hasNodeIds = Object.prototype.hasOwnProperty.call(body, "nodeIds");
  const hasFilterIds = Object.prototype.hasOwnProperty.call(body, "filterIds");
  const hasIsDefault = Object.prototype.hasOwnProperty.call(body, "isDefault");

  if (Object.prototype.hasOwnProperty.call(body, "name") && typeof body.name !== "string") {
    return error("VALIDATION_ERROR", "validation.branchNameRequiredSimple");
  }
  if (hasNodeIds && !Array.isArray(body.nodeIds)) {
    return error("VALIDATION_ERROR", "validation.nodeIdsMustBeArray");
  }
  if (hasFilterIds && !Array.isArray(body.filterIds)) {
    return error("VALIDATION_ERROR", "validation.filterIdsMustBeArray");
  }
  if (hasIsDefault && typeof body.isDefault !== "boolean") {
    return error("VALIDATION_ERROR", "validation.isDefaultMustBeBoolean");
  }

  const existingNodeIds = db
    .select({ nodeId: lineNodes.nodeId })
    .from(lineNodes)
    .where(eq(lineNodes.branchId, bId))
    .orderBy(lineNodes.hopOrder)
    .all()
    .map((r) => r.nodeId);
  const existingFilterIds = db
    .select({ filterId: branchFilters.filterId })
    .from(branchFilters)
    .where(eq(branchFilters.branchId, bId))
    .all()
    .map((r) => r.filterId);

  const nextInput: BranchInput = {
    name: typeof body.name === "string" ? body.name : branch.name,
    isDefault: hasIsDefault ? body.isDefault === true : branch.isDefault,
    nodeIds: hasNodeIds && Array.isArray(body.nodeIds) ? body.nodeIds.map(Number) : existingNodeIds,
    filterIds: hasFilterIds && Array.isArray(body.filterIds) ? body.filterIds.map(Number) : existingFilterIds,
  };

  const validationError = validateBranchInput(nextInput, entryNodeId);
  if (validationError) {
    return error("VALIDATION_ERROR", validationError.message, validationError.params);
  }

  if (hasIsDefault && !nextInput.isDefault && branch.isDefault) {
    const otherDefault = db
      .select({ id: lineBranches.id })
      .from(lineBranches)
      .where(and(eq(lineBranches.lineId, lineId), eq(lineBranches.isDefault, true)))
      .all()
      .some((b) => b.id !== bId);
    if (!otherDefault) return error("VALIDATION_ERROR", "validation.exactlyOneDefaultBranch");
  }

  const nodeIdsChanged = hasNodeIds && !sameNumberArray(existingNodeIds, nextInput.nodeIds);
  const filtersChanged = hasFilterIds && !sameNumberArray(existingFilterIds, nextInput.filterIds ?? []);
  const nameChanged = nextInput.name.trim() !== branch.name;
  const defaultChanged = hasIsDefault && nextInput.isDefault !== branch.isDefault;

  if (!nodeIdsChanged && !filtersChanged && !nameChanged && !defaultChanged) {
    return success(getBranchDetail(bId));
  }

  const oldBranchNodeIds = getBranchNonEntryParticipantNodeIds(bId, entryNodeId);
  const affectedNodeIds = new Set<number>([entryNodeId, ...oldBranchNodeIds, ...nextInput.nodeIds]);
  const allocation = nodeIdsChanged
    ? buildAllocationState([entryNodeId, ...nextInput.nodeIds], [bId])
    : null;

  db.transaction((tx) => {
    if (nextInput.isDefault) {
      tx.update(lineBranches)
        .set({ isDefault: false, updatedAt: sql`(datetime('now'))` })
        .where(eq(lineBranches.lineId, lineId))
        .run();
    }

    tx.update(lineBranches)
      .set({
        name: nextInput.name.trim(),
        isDefault: nextInput.isDefault,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(lineBranches.id, bId))
      .run();

    if (nodeIdsChanged && allocation) {
      replaceBranchTopology(tx, lineId, bId, entryNodeId, nextInput.nodeIds, allocation);
      normalizeLineTunnelHopIndexes(tx, lineId);
    }

    if (hasFilterIds || hasIsDefault) {
      replaceBranchFilters(tx, bId, nextInput.isDefault, nextInput.filterIds);
    }

    tx.update(lines).set({ updatedAt: sql`(datetime('now'))` }).where(eq(lines.id, lineId)).run();
  });

  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: lineId,
    targetName: line.name,
    detail: `branch ${bId} update: name="${nextInput.name.trim()}", default=${nextInput.isDefault}, nodes=[${nextInput.nodeIds.join(",")}], filters=[${(nextInput.filterIds ?? []).join(",")}]`,
  });

  notifyNodeIds(affectedNodeIds);

  return success(getBranchDetail(bId));
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, branchId } = await params;
  const lineId = parseInt(id, 10);
  const bId = parseInt(branchId, 10);
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

  const branches = db
    .select({ id: lineBranches.id, isDefault: lineBranches.isDefault })
    .from(lineBranches)
    .where(eq(lineBranches.lineId, lineId))
    .all();
  if (branches.length <= 1) {
    return error("VALIDATION_ERROR", "validation.cannotDeleteLastBranch");
  }
  if (branch.isDefault) {
    return error("VALIDATION_ERROR", "validation.cannotDeleteDefaultBranch");
  }

  const affectedNodeIds = new Set<number>(getLineParticipantNodeIds(lineId));

  db.transaction((tx) => {
    tx.delete(lineBranches).where(eq(lineBranches.id, bId)).run();
    normalizeLineTunnelHopIndexes(tx, lineId);
    tx.update(lines).set({ updatedAt: sql`(datetime('now'))` }).where(eq(lines.id, lineId)).run();
  });

  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: lineId,
    targetName: line.name,
    detail: `branch ${bId} delete: "${branch.name}"`,
  });

  notifyNodeIds(affectedNodeIds);

  return success({ id: bId });
}
