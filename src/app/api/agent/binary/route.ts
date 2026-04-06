import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const binaryPath = path.join(process.cwd(), "public", "agent", "wiremesh-agent-linux-amd64");

  if (!fs.existsSync(binaryPath)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Agent 二进制文件不存在" } }, { status: 404 });
  }

  const buffer = fs.readFileSync(binaryPath);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="wiremesh-agent-linux-amd64"',
      "Content-Length": buffer.length.toString(),
    },
  });
}
