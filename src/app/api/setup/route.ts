import { db } from "@/lib/db";
import { users, settings } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { created, error } from "@/lib/api-response";
import { count } from "drizzle-orm";

export async function POST(request: Request) {
  const [result] = await db.select({ count: count() }).from(users);
  if (result.count > 0) {
    return error("CONFLICT", "system.alreadyInitialized");
  }

  const body = await request.json();
  const { username, password, wgDefaultSubnet } = body;

  if (!username || username.length < 1) {
    return error("VALIDATION_ERROR", "validation.usernameRequired");
  }
  if (!password || password.length < 6) {
    return error("VALIDATION_ERROR", "validation.passwordMinLength");
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db.insert(users).values({ username, passwordHash }).returning({
    id: users.id,
    username: users.username,
    createdAt: users.createdAt,
  });

  const defaultSettings = [
    { key: "wg_default_port", value: "41820" },
    { key: "wg_default_subnet", value: wgDefaultSubnet || "10.210.0.0/24" },
    { key: "wg_default_dns", value: "1.1.1.1" },
    { key: "wg_node_ip_start", value: "1" },
    { key: "wg_device_ip_start", value: "100" },
    { key: "xray_default_protocol", value: "vless" },
    { key: "xray_default_transport", value: "ws" },
    { key: "xray_default_port", value: "41443" },
    { key: "tunnel_subnet", value: "10.211.0.0/16" },
    { key: "tunnel_port_start", value: "41830" },
    { key: "node_check_interval", value: "5" },
  ];

  await db.insert(settings).values(defaultSettings);

  return created({ user });
}
