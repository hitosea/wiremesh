import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const VALID_ARCHS = ["amd64", "arm64"];

export async function GET(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";

  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}. Supported: ${VALID_ARCHS.join(", ")}` } },
      { status: 400 }
    );
  }

  const filename = `xray-linux-${arch}.tar.gz`;
  const filePath = path.join(process.cwd(), "public", "xray", filename);

  if (!fs.existsSync(filePath)) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: `Xray binary not found: ${filename}` } },
      { status: 404 }
    );
  }

  const buffer = fs.readFileSync(filePath);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}
