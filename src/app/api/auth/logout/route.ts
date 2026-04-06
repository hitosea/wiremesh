import { success } from "@/lib/api-response";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete("token");
  return success({ message: "已退出登录" });
}
