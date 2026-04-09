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
    return error("UNAUTHORIZED", "auth.notLoggedIn");
  }

  let payload: { sub: string; username: string };
  try {
    payload = await verifyToken(token);
  } catch {
    return error("UNAUTHORIZED", "auth.sessionExpired");
  }

  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return error("VALIDATION_ERROR", "validation.currentAndNewPasswordRequired");
  }
  if (newPassword.length < 6) {
    return error("VALIDATION_ERROR", "validation.newPasswordMinLength");
  }

  const [user] = await db.select().from(users).where(eq(users.id, Number(payload.sub)));
  if (!user) {
    return error("UNAUTHORIZED", "auth.userNotFound");
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return error("VALIDATION_ERROR", "validation.currentPasswordWrong");
  }

  const newHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

  return success({ message: "密码已更新" });
}
