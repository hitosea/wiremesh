import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
};

// ===== users =====
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

// ===== settings =====
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ===== nodes =====
export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  domain: text("domain"),
  port: integer("port").notNull().default(51820),
  agentToken: text("agent_token").notNull().unique(),
  wgPrivateKey: text("wg_private_key").notNull(),
  wgPublicKey: text("wg_public_key").notNull(),
  wgAddress: text("wg_address").notNull(),
  xrayProtocol: text("xray_protocol"),
  xrayTransport: text("xray_transport"),
  xrayPort: integer("xray_port"),
  xrayConfig: text("xray_config"),
  xrayWsPath: text("xray_ws_path"),
  xrayTlsDomain: text("xray_tls_domain"),
  xrayTlsCert: text("xray_tls_cert"),
  xrayTlsKey: text("xray_tls_key"),
  externalInterface: text("external_interface").notNull().default("eth0"),
  status: text("status").notNull().default("offline"),
  errorMessage: text("error_message"),
  agentVersion: text("agent_version"),
  xrayVersion: text("xray_version"),
  upgradeTriggeredAt: text("upgrade_triggered_at"),
  xrayUpgradeTriggeredAt: text("xray_upgrade_triggered_at"),
  pendingDelete: integer("pending_delete", { mode: "boolean" }).notNull().default(false),
  tunnelPortBlacklist: text("tunnel_port_blacklist").notNull().default(""),
  remark: text("remark"),
  ...timestamps,
});

// ===== node_status =====
export const nodeStatus = sqliteTable("node_status", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nodeId: integer("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  isOnline: integer("is_online", { mode: "boolean" }).notNull(),
  latency: integer("latency"),
  uploadBytes: integer("upload_bytes").notNull().default(0),
  downloadBytes: integer("download_bytes").notNull().default(0),
  forwardUploadBytes: integer("forward_upload_bytes").notNull().default(0),
  forwardDownloadBytes: integer("forward_download_bytes").notNull().default(0),
  checkedAt: text("checked_at").notNull().default(sql`(datetime('now'))`),
});

// ===== lines =====
export const lines = sqliteTable("lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  xrayPort: integer("xray_port"),
  socks5Port: integer("socks5_port"),
  remark: text("remark"),
  ...timestamps,
});

// ===== line_branches =====
export const lineBranches = sqliteTable("line_branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id").notNull().references(() => lines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

// ===== line_nodes =====
export const lineNodes = sqliteTable("line_nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id").notNull().references(() => lines.id, { onDelete: "cascade" }),
  nodeId: integer("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => lineBranches.id, { onDelete: "cascade" }),
  hopOrder: integer("hop_order").notNull(),
  role: text("role").notNull(),
});

// ===== line_tunnels =====
export const lineTunnels = sqliteTable("line_tunnels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id").notNull().references(() => lines.id, { onDelete: "cascade" }),
  hopIndex: integer("hop_index").notNull(),
  fromNodeId: integer("from_node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  toNodeId: integer("to_node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  fromWgPrivateKey: text("from_wg_private_key").notNull(),
  fromWgPublicKey: text("from_wg_public_key").notNull(),
  fromWgAddress: text("from_wg_address").notNull(),
  fromWgPort: integer("from_wg_port").notNull(),
  toWgPrivateKey: text("to_wg_private_key").notNull(),
  toWgPublicKey: text("to_wg_public_key").notNull(),
  toWgAddress: text("to_wg_address").notNull(),
  toWgPort: integer("to_wg_port").notNull(),
  branchId: integer("branch_id").references(() => lineBranches.id, { onDelete: "cascade" }),
});

// ===== devices =====
export const devices = sqliteTable("devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  wgPublicKey: text("wg_public_key"),
  wgPrivateKey: text("wg_private_key"),
  wgAddress: text("wg_address"),
  xrayUuid: text("xray_uuid"),
  xrayConfig: text("xray_config"),
  socks5Username: text("socks5_username"),
  socks5Password: text("socks5_password"),
  lineId: integer("line_id").references(() => lines.id, { onDelete: "set null" }),
  status: text("status").notNull().default("offline"),
  lastHandshake: text("last_handshake"),
  uploadBytes: integer("upload_bytes").notNull().default(0),
  downloadBytes: integer("download_bytes").notNull().default(0),
  connectionCount: integer("connection_count").notNull().default(0),
  activeIps: text("active_ips"),
  remark: text("remark"),
  ...timestamps,
});

// ===== filters =====
export const filters = sqliteTable("filters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  rules: text("rules").notNull(),
  mode: text("mode").notNull().default("whitelist"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  remark: text("remark"),
  domainRules: text("domain_rules"),
  sourceUrl: text("source_url"),
  sourceUpdatedAt: text("source_updated_at"),
  sourceSyncStatus: text("source_sync_status"),
  sourceLastError: text("source_last_error"),
  sourceLastIpCount: integer("source_last_ip_count"),
  sourceLastDomainCount: integer("source_last_domain_count"),
  ...timestamps,
});

// ===== branch_filters =====
export const branchFilters = sqliteTable("branch_filters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => lineBranches.id, { onDelete: "cascade" }),
  filterId: integer("filter_id").notNull().references(() => filters.id, { onDelete: "cascade" }),
});

// ===== subscription_groups =====
export const subscriptionGroups = sqliteTable("subscription_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  token: text("token").notNull().unique(),
  remark: text("remark"),
  ...timestamps,
});

// ===== subscription_group_devices =====
export const subscriptionGroupDevices = sqliteTable("subscription_group_devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull().references(() => subscriptionGroups.id, { onDelete: "cascade" }),
  deviceId: integer("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ===== audit_logs =====
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  targetName: text("target_name"),
  detail: text("detail"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
