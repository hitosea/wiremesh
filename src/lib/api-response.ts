import { NextResponse } from "next/server";

export function success(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function created(data: unknown) {
  return success(data, 201);
}

export function paginated(
  data: unknown[],
  pagination: { page: number; pageSize: number; total: number },
  extra?: Record<string, unknown>
) {
  return NextResponse.json({
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.pageSize),
    },
    ...extra,
  });
}

type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "NODE_OFFLINE"
  | "CONFIG_SYNC_FAILED";

const STATUS_MAP: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  NODE_OFFLINE: 503,
  CONFIG_SYNC_FAILED: 502,
};

export function error(
  code: ErrorCode,
  message: string,
  params?: Record<string, string | number>,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      error: { code, message, ...(params && { params }) },
      ...(details && { details }),
    },
    { status: STATUS_MAP[code] }
  );
}
