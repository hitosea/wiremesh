import { NextRequest, NextResponse } from "next/server";
import { isValidTokenShape } from "@/lib/subscription/token";
import { findGroupByToken, renderClash, renderShadowrocket } from "@/lib/subscription/render";

type Params = { params: Promise<{ token: string; fmt: string }> };

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "wiremesh";
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

  if (fmt === "clash") {
    const subHost = request.headers.get("host");
    const result = renderClash(group, subHost);
    return new NextResponse(result.body, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `inline; filename="wiremesh-${safeFilename(group.name)}.yaml"`,
        "profile-update-interval": "24",
        "Cache-Control": "no-store",
      },
    });
  }

  if (fmt === "shadowrocket") {
    const result = renderShadowrocket(group);
    return new NextResponse(result.body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse("Unsupported format", { status: 400 });
}
