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

async function checkInitialized(request: NextRequest): Promise<boolean> {
  try {
    const url = new URL("/api/setup/status", request.url);
    const res = await fetch(url);
    const data = await res.json();
    return data?.data?.initialized === true;
  } catch {
    return true; // If check fails, assume initialized to avoid redirect loop
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticPath(pathname) || isAgentPath(pathname)) {
    return NextResponse.next();
  }

  // Always allow setup-related paths
  if (pathname === "/setup" || pathname.startsWith("/api/setup")) {
    return NextResponse.next();
  }

  // For non-setup pages, check if system is initialized
  // If not, redirect to /setup
  if (!pathname.startsWith("/api/")) {
    const initialized = await checkInitialized(request);
    if (!initialized) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }
  }

  // Allow remaining public paths (login, auth API)
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check JWT
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
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
