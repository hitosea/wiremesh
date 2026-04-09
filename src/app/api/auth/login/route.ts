import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword, signToken } from "@/lib/auth";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const body = await request.json();
  const { username, password } = body;

  if (!username || !password) {
    return error("VALIDATION_ERROR", "validation.usernameAndPasswordRequired");
  }

  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user) {
    return error("UNAUTHORIZED", "auth.unauthorized");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return error("UNAUTHORIZED", "auth.unauthorized");
  }

  const token = await signToken({ sub: String(user.id), username: user.username });

  const cookieStore = await cookies();
  cookieStore.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });

  return success({
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
    },
  });
}
