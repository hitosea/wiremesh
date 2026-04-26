import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { count } from "drizzle-orm";

const PUBLIC_PATHS = ["/login", "/setup", "/api/setup", "/api/auth/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAgentPath(pathname: string): boolean {
  return pathname.startsWith("/api/agent/");
}

function isNodeScriptPath(pathname: string): boolean {
  return /^\/api\/nodes\/\d+\/script$/.test(pathname);
}

function isUninstallScriptPath(pathname: string): boolean {
  return pathname === "/api/uninstall-script";
}

function isSubscriptionFetchPath(pathname: string): boolean {
  // Public subscription URLs are token-authed in their own handler;
  // the JWT cookie check is bypassed here.
  return pathname.startsWith("/api/sub/");
}

function isStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next") || pathname === "/favicon.ico";
}

async function checkInitialized(_request: NextRequest): Promise<boolean> {
  try {
    const [result] = await db.select({ count: count() }).from(users);
    return result.count > 0;
  } catch {
    return true; // If check fails, assume initialized to avoid redirect loop
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    isStaticPath(pathname) ||
    isAgentPath(pathname) ||
    isNodeScriptPath(pathname) ||
    isUninstallScriptPath(pathname) ||
    isSubscriptionFetchPath(pathname)
  ) {
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
