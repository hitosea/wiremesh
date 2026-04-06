import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { success } from "@/lib/api-response";
import { count } from "drizzle-orm";

export async function GET() {
  const [result] = await db.select({ count: count() }).from(users);
  return success({ initialized: result.count > 0 });
}
