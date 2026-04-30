import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodeProtocols } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid Agent Token" } },
      { status: 401 }
    );
  }

  const body = await request.json();
  const { domain, cert, key } = body;

  if (!domain || !cert || !key) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "domain, cert, key required" } },
      { status: 400 }
    );
  }

  // Look up the ws-tls protocol config for this node
  const npRow = db.select().from(nodeProtocols)
    .where(and(eq(nodeProtocols.nodeId, node.id), eq(nodeProtocols.protocol, "xray-wstls")))
    .get();

  let cfg: Record<string, string> = {};
  if (npRow) {
    try { cfg = JSON.parse(npRow.config); } catch { cfg = {}; }
  }

  if (!npRow || cfg.tlsDomain !== domain) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "domain mismatch" } },
      { status: 400 }
    );
  }

  const newCfg = { ...cfg, tlsCert: cert, tlsKey: encrypt(key) };

  db.update(nodeProtocols)
    .set({
      config: JSON.stringify(newCfg),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(and(eq(nodeProtocols.nodeId, node.id), eq(nodeProtocols.protocol, "xray-wstls")))
    .run();

  return Response.json({ data: { message: "Certificate stored" } });
}
