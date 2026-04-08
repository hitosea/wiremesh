import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, branchFilters } from "@/lib/db/schema";
import { success, created, error, paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, like, count, and } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyFilterChange } from "@/lib/filter-notify";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");

  const conditions: (ReturnType<typeof like>)[] = [];
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

  const enriched = rows.map((row) => {
    const ipCount = row.rules ? row.rules.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length : 0;
    const domainCount = row.domainRules ? row.domainRules.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length : 0;
    const branchCount = db.select({ count: count() }).from(branchFilters).where(eq(branchFilters.filterId, row.id)).get()?.count ?? 0;
    return { ...row, rulesCount: ipCount + domainCount, branchCount };
  });

  return paginated(enriched, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, rules, domainRules, mode, branchIds, sourceUrl, tags, remark } = body;

  if (!name || !name.trim()) return error("VALIDATION_ERROR", "name 为必填项");
  if (!rules && !domainRules && !sourceUrl) return error("VALIDATION_ERROR", "IP/CIDR 规则、域名规则和外部规则源至少填写一项");
  if (!mode || !["whitelist", "blacklist"].includes(mode)) {
    return error("VALIDATION_ERROR", "mode 必须是 whitelist 或 blacklist");
  }

  const filter = db
    .insert(filters)
    .values({
      name: name.trim(),
      rules: rules ?? "",
      domainRules: domainRules ?? "",
      sourceUrl: sourceUrl ?? null,
      mode,
      isEnabled: true,
      tags: tags ?? null,
      remark: remark ?? null,
    })
    .returning()
    .get();

  // Insert branch associations
  if (branchIds && Array.isArray(branchIds)) {
    for (const branchId of branchIds) {
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

  notifyFilterChange(filter.id);

  return created(filter);
}
