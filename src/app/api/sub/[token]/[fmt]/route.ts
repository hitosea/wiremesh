import { NextRequest, NextResponse } from "next/server";
import { isValidTokenShape } from "@/lib/subscription/token";
import { findGroupByToken, renderSubscription } from "@/lib/subscription/render";
import { resolveFormat } from "@/lib/subscription/formats";
import { loadGroupTraffic, formatSubscriptionUserinfo } from "@/lib/subscription/traffic";

type Params = { params: Promise<{ token: string; fmt: string }> };

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "wiremesh";
}

function fileExtension(format: string): string {
  if (format === "clash") return "yaml";
  if (format === "singbox") return "json";
  return "txt";
}

export async function GET(request: NextRequest, { params }: Params) {
  const { token, fmt } = await params;

  if (!isValidTokenShape(token)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const group = findGroupByToken(token);
  if (!group) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const format = resolveFormat(fmt);
  if (!format) {
    return new NextResponse("Unsupported format", { status: 400 });
  }

  const subHost = request.headers.get("host");
  const result = renderSubscription(group, format, subHost, fmt.toLowerCase());
  const traffic = loadGroupTraffic(group.id);

  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Cache-Control": "no-store",
    "profile-update-interval": "24",
    "Content-Disposition": `inline; filename="wiremesh-${safeFilename(group.name)}.${fileExtension(format)}"`,
    // Subscription title — clients display this as the profile name on
    // import. Convention is base64-prefixed text (Surge/sing-box flavour).
    "profile-title": `base64:${Buffer.from(group.name, "utf8").toString("base64")}`,
    // Traffic stats — Clash Verge / Hiddify / sing-box GUI parse this and
    // render a usage banner. total=0/expire=0 means "no quota / no expire".
    "subscription-userinfo": formatSubscriptionUserinfo(traffic),
  };

  return new NextResponse(result.body, { status: 200, headers });
}
