import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
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

  if (node.xrayTlsDomain !== domain) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "domain mismatch" } },
      { status: 400 }
    );
  }

  db.update(nodes)
    .set({
      xrayTlsCert: cert,
      xrayTlsKey: encrypt(key),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(nodes.id, node.id))
    .run();

  return Response.json({ data: { message: "Certificate stored" } });
}
