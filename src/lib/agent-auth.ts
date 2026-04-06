import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type AuthedNode = typeof nodes.$inferSelect;

export function authenticateAgent(request: NextRequest): AuthedNode | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const node = db.select().from(nodes).where(eq(nodes.agentToken, token)).get();
  return node ?? null;
}
