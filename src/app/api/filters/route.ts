import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, branchFilters } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, like, count, and, SQL } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");

  const conditions: SQL[] = [];
  if (search) conditions.push(like(filters.name, `%${search}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db.select({ count: count() }).from(filters).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(filters)
    .where(where)
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  return paginated(rows, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, rules, mode, lineIds, tags, remark } = body;

  if (!name || !name.trim()) return error("VALIDATION_ERROR", "name 为必填项");
  if (!rules) return error("VALIDATION_ERROR", "rules 为必填项");
  if (!mode || !["whitelist", "blacklist"].includes(mode)) {
    return error("VALIDATION_ERROR", "mode 必须是 whitelist 或 blacklist");
  }

  const filter = db
    .insert(filters)
    .values({
      name: name.trim(),
      rules,
      mode,
      isEnabled: true,
      tags: tags ?? null,
      remark: remark ?? null,
    })
    .returning()
    .get();

  // Insert branch associations
  if (lineIds && Array.isArray(lineIds)) {
    for (const branchId of lineIds) {
      db.insert(branchFilters)
        .values({ branchId, filterId: filter.id })
        .run();
    }
  }

  writeAuditLog({
    action: "create",
    targetType: "filter",
    targetId: filter.id,
    targetName: name.trim(),
    detail: `mode=${mode}`,
  });

  return created(filter);
}
