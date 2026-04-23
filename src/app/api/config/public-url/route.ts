import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { success, error } from "@/lib/api-response";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return error("UNAUTHORIZED", "auth.notLoggedIn");
  try {
    await verifyToken(token);
  } catch {
    return error("UNAUTHORIZED", "auth.sessionExpired");
  }
  return success({ publicUrl: process.env.PUBLIC_URL || null });
}
