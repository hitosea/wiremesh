import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";
import { adminSseManager } from "@/lib/admin-sse-manager";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "无效的 Agent Token" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const filterId = parseInt(id);
  if (isNaN(filterId)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "invalid filter id" } },
      { status: 400 }
    );
  }

  const body = await request.json() as {
    success: boolean;
    ip_count?: number;
    domain_count?: number;
    error?: string;
  };

  const now = new Date().toISOString();
  const ipCount = body.ip_count ?? 0;
  const domainCount = body.domain_count ?? 0;
  const status = body.success ? "ok" : "error";
  const lastError = body.success ? null : (body.error ?? "unknown error");

  const updated = db
    .update(filters)
    .set({
      sourceUpdatedAt: now,
      sourceSyncStatus: status,
      sourceLastError: lastError,
      sourceLastIpCount: body.success ? ipCount : null,
      sourceLastDomainCount: body.success ? domainCount : null,
    })
    .where(eq(filters.id, filterId))
    .returning({ id: filters.id })
    .get();

  if (!updated) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "filter not found" } },
      { status: 404 }
    );
  }

  adminSseManager.broadcast("filter_sync", {
    filterId,
    nodeId: node.id,
    success: body.success,
    syncedAt: now,
    ipCount: body.success ? ipCount : null,
    domainCount: body.success ? domainCount : null,
    error: lastError,
  });

  return Response.json({ data: { ok: true } });
}
