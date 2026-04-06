export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export function parsePaginationParams(searchParams: URLSearchParams): PaginationParams {
  return {
    page: Math.max(1, parseInt(searchParams.get("page") || "1")),
    pageSize: Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20"))),
    sortBy: searchParams.get("sortBy") || "created_at",
    sortOrder: searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
  };
}

export function paginationOffset(params: PaginationParams): number {
  return (params.page - 1) * params.pageSize;
}
