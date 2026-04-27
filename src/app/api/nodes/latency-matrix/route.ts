import { success } from "@/lib/api-response";
import { buildLatencyMatrix } from "@/lib/node-latency-matrix";

export const dynamic = "force-dynamic";

export async function GET() {
  return success(buildLatencyMatrix());
}
