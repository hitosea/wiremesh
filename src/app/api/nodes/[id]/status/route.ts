import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, nodeStatus } from "@/lib/db/schema";
import { eq, count, desc } from "drizzle-orm";
import { error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "无效的节点 ID");

  const node = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "节点不存在");

  const paginationParams = parsePaginationParams(request.nextUrl.searchParams);

  const total =
    db.select({ count: count() }).from(nodeStatus).where(eq(nodeStatus.nodeId, nodeId)).get()?.count ?? 0;

  const rows = db
    .select()
    .from(nodeStatus)
    .where(eq(nodeStatus.nodeId, nodeId))
    .orderBy(desc(nodeStatus.checkedAt))
    .limit(paginationParams.pageSize)
    .offset(paginationOffset(paginationParams))
    .all();

  return paginated(rows, {
    page: paginationParams.page,
    pageSize: paginationParams.pageSize,
    total,
  });
}
