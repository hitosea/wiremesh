import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/setup", "/api/setup", "/api/auth/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAgentPath(pathname: string): boolean {
  return pathname.startsWith("/api/agent/");
}

function isStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next") || pathname === "/favicon.ico";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticPath(pathname) || isPublicPath(pathname) || isAgentPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;

  if (!token) {
    return handleUnauthorized(request);
  }

  try {
    await verifyToken(token);
    return NextResponse.next();
  } catch {
    return handleUnauthorized(request);
  }
}

function handleUnauthorized(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录或会话已过期" } },
      { status: 401 }
    );
  }
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
