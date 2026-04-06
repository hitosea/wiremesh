import { db } from "@/lib/db";
import { users, settings } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { created, error } from "@/lib/api-response";
import { count } from "drizzle-orm";

export async function POST(request: Request) {
  const [result] = await db.select({ count: count() }).from(users);
  if (result.count > 0) {
    return error("CONFLICT", "系统已初始化");
  }

  const body = await request.json();
  const { username, password, wgDefaultSubnet } = body;

  if (!username || username.length < 1) {
    return error("VALIDATION_ERROR", "用户名不能为空");
  }
  if (!password || password.length < 6) {
    return error("VALIDATION_ERROR", "密码至少需要 6 位字符");
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db.insert(users).values({ username, passwordHash }).returning({
    id: users.id,
    username: users.username,
    createdAt: users.createdAt,
  });

  const defaultSettings = [
    { key: "wg_default_port", value: "51820" },
    { key: "wg_default_subnet", value: wgDefaultSubnet || "10.0.0.0/24" },
    { key: "wg_default_dns", value: "1.1.1.1" },
    { key: "wg_node_ip_start", value: "1" },
    { key: "wg_device_ip_start", value: "100" },
    { key: "xray_default_protocol", value: "vless" },
    { key: "xray_default_transport", value: "ws" },
    { key: "xray_default_port", value: "443" },
    { key: "tunnel_subnet", value: "10.1.0.0/16" },
    { key: "tunnel_port_start", value: "51830" },
    { key: "node_check_interval", value: "5" },
  ];

  await db.insert(settings).values(defaultSettings);

  return created({ user });
}
