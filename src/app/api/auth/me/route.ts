import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyToken } from "@/lib/auth";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return error("UNAUTHORIZED", "未登录");
  }

  let payload: { sub: string; username: string };
  try {
    payload = await verifyToken(token);
  } catch {
    return error("UNAUTHORIZED", "会话已过期");
  }

  const [user] = await db
    .select({ id: users.id, username: users.username, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, Number(payload.sub)));

  if (!user) {
    return error("UNAUTHORIZED", "用户不存在");
  }

  return success({ user });
}
