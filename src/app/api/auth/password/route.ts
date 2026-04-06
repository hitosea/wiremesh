import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword, verifyToken } from "@/lib/auth";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function PUT(request: Request) {
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

  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return error("VALIDATION_ERROR", "当前密码和新密码不能为空");
  }
  if (newPassword.length < 6) {
    return error("VALIDATION_ERROR", "新密码至少需要 6 位字符");
  }

  const [user] = await db.select().from(users).where(eq(users.id, Number(payload.sub)));
  if (!user) {
    return error("UNAUTHORIZED", "用户不存在");
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return error("VALIDATION_ERROR", "当前密码错误");
  }

  const newHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

  return success({ message: "密码已更新" });
}
