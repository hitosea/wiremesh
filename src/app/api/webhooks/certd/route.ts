import { NextRequest } from "next/server";
import {
  authenticate,
  parsePayload,
  applyCertToMatchingNodes,
} from "@/lib/certd-webhook";
import { success, error } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = authenticate(request);
  if (!auth.ok) return error(auth.code, auth.message);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "body must be valid JSON");
  }

  const parsed = parsePayload(body);
  if (!parsed.ok) return error("VALIDATION_ERROR", parsed.reason);

  const result = applyCertToMatchingNodes(parsed.data);
  return success({
    domain: parsed.data.domain,
    matched: result.matched,
    updated: result.updated,
  });
}
