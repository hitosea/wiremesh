import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const VALID_ARCHS = ["amd64", "arm64"];

function getFileInfo(arch: string) {
  const filename = `wiremesh-agent-linux-${arch}.tar.gz`;
  const filePath = path.join(process.cwd(), "public", "agent", filename);
  const versionPath = path.join(process.cwd(), "public", "agent", "agent-version.txt");
  const checksumPath = filePath + ".sha256";

  if (!fs.existsSync(filePath)) return null;

  const version = fs.existsSync(versionPath) ? fs.readFileSync(versionPath, "utf-8").trim() : "unknown";
  let checksum = "";
  if (fs.existsSync(checksumPath)) {
    checksum = fs.readFileSync(checksumPath, "utf-8").trim().split(/\s+/)[0];
  } else {
    const buffer = fs.readFileSync(filePath);
    checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  }

  return { filePath, filename, version, checksum };
}

function buildHeaders(info: { filename: string; version: string; checksum: string; contentLength?: number }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${info.filename}"`,
    "X-Agent-Version": info.version,
    "X-Agent-Checksum": `sha256:${info.checksum}`,
  };
  if (info.contentLength !== undefined) {
    headers["Content-Length"] = info.contentLength.toString();
  }
  return headers;
}

export async function HEAD(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";
  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}` } },
      { status: 400 }
    );
  }
  const info = getFileInfo(arch);
  if (!info) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Agent binary not found" } },
      { status: 404 }
    );
  }
  return new Response(null, { headers: buildHeaders(info) });
}

export async function GET(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get("arch") || "amd64";
  if (!VALID_ARCHS.includes(arch)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: `Invalid arch: ${arch}` } },
      { status: 400 }
    );
  }
  const info = getFileInfo(arch);
  if (!info) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Agent binary not found" } },
      { status: 404 }
    );
  }
  const buffer = fs.readFileSync(info.filePath);
  return new Response(buffer, {
    headers: buildHeaders({ ...info, contentLength: buffer.length }),
  });
}
