import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { desc, eq, count, and, SQL } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const targetType = request.nextUrl.searchParams.get("targetType");
  const action = request.nextUrl.searchParams.get("action");

  const conditions: SQL[] = [];
  if (targetType) conditions.push(eq(auditLogs.targetType, targetType));
  if (action) conditions.push(eq(auditLogs.action, action));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db.select({ count: count() }).from(auditLogs).where(where).get()?.count ??
    0;
  const rows = db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  return paginated(rows, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}
