import { NextRequest, NextResponse } from "next/server";

// Redirect to the generic uninstall script — no node ID or token needed
export async function GET(request: NextRequest) {
  const url = new URL("/api/uninstall-script", request.url);
  return NextResponse.redirect(url, 302);
}
