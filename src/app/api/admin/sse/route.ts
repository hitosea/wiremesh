import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { adminSseManager } from "@/lib/admin-sse-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "auth.notLoggedIn" } },
      { status: 401 }
    );
  }

  try {
    await verifyToken(token);
  } catch {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "auth.sessionExpired" } },
      { status: 401 }
    );
  }

  let connectionId: number;

  const stream = new ReadableStream({
    start(controller) {
      connectionId = adminSseManager.addConnection(controller);
      const message = `event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`;
      controller.enqueue(new TextEncoder().encode(message));
    },
    cancel() {
      adminSseManager.removeConnection(connectionId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
