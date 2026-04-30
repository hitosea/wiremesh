import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { nodes, lines, lineProtocols } from "@/lib/db/schema";
import {
  enableNodeProtocol,
  disableNodeProtocol,
  getNodeProtocols,
  setNodeProtocolConfig,
  ensureLineProtocol,
  releaseLineProtocol,
  isProtocolSupportedByEntryNode,
} from "@/lib/db/protocols";

let db: BetterSQLite3Database<typeof schema>;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("node_protocols helpers", () => {
  it("enableNodeProtocol creates a row with config JSON", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();

    enableNodeProtocol(db, node.id, "xray-reality", { realityDest: "www.x.com:443" });

    const rows = getNodeProtocols(db, node.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].protocol).toBe("xray-reality");
    expect(JSON.parse(rows[0].config)).toEqual({ realityDest: "www.x.com:443" });
  });

  it("setNodeProtocolConfig updates an existing row", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    enableNodeProtocol(db, node.id, "xray-reality", { realityDest: "old:443" });

    setNodeProtocolConfig(db, node.id, "xray-reality", { realityDest: "new:443" });

    const cfg = JSON.parse(getNodeProtocols(db, node.id)[0].config);
    expect(cfg.realityDest).toBe("new:443");
  });

  it("disableNodeProtocol removes the row", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    enableNodeProtocol(db, node.id, "xray-wstls", { tlsDomain: "x.com" });

    disableNodeProtocol(db, node.id, "xray-wstls");

    expect(getNodeProtocols(db, node.id)).toHaveLength(0);
  });

  it("two protocols on the same node coexist; disabling one keeps the other", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();

    enableNodeProtocol(db, node.id, "xray-reality", { realityDest: "a:443" });
    enableNodeProtocol(db, node.id, "xray-wstls", { tlsDomain: "b.com" });
    expect(getNodeProtocols(db, node.id)).toHaveLength(2);

    disableNodeProtocol(db, node.id, "xray-reality");

    const remaining = getNodeProtocols(db, node.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].protocol).toBe("xray-wstls");
  });

  it("operations on one node do not affect another node's rows", () => {
    const a = db.insert(nodes).values({
      name: "a", ip: "1.1.1.1", agentToken: "ta",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    const b = db.insert(nodes).values({
      name: "b", ip: "2.2.2.2", agentToken: "tb",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.2",
    }).returning().get();

    enableNodeProtocol(db, a.id, "xray-reality", { realityDest: "a:443" });
    enableNodeProtocol(db, b.id, "xray-reality", { realityDest: "b:443" });

    disableNodeProtocol(db, a.id, "xray-reality");

    expect(getNodeProtocols(db, a.id)).toHaveLength(0);
    expect(getNodeProtocols(db, b.id)).toHaveLength(1);
    expect(JSON.parse(getNodeProtocols(db, b.id)[0].config).realityDest).toBe("b:443");
  });
});

describe("line_protocols helpers", () => {
  it("ensureLineProtocol allocates a port for first call", () => {
    const line = db.insert(lines).values({ name: "L1" }).returning().get();
    const port = ensureLineProtocol(db, line.id, "xray-reality", { startPort: 41443 });
    expect(port).toBe(41443);

    const rows = db.select().from(lineProtocols).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].port).toBe(41443);
  });

  it("ensureLineProtocol skips ports in use across the same protocol", () => {
    const a = db.insert(lines).values({ name: "A" }).returning().get();
    const b = db.insert(lines).values({ name: "B" }).returning().get();
    expect(ensureLineProtocol(db, a.id, "xray-reality", { startPort: 41443 })).toBe(41443);
    expect(ensureLineProtocol(db, b.id, "xray-reality", { startPort: 41443 })).toBe(41444);
  });

  it("ensureLineProtocol allows same port for different protocols on different lines", () => {
    const a = db.insert(lines).values({ name: "A" }).returning().get();
    const b = db.insert(lines).values({ name: "B" }).returning().get();
    expect(ensureLineProtocol(db, a.id, "xray-reality", { startPort: 41443 })).toBe(41443);
    expect(ensureLineProtocol(db, b.id, "socks5", { startPort: 41443 })).toBe(41443);
  });

  it("ensureLineProtocol returns existing port on subsequent calls", () => {
    const l = db.insert(lines).values({ name: "L" }).returning().get();
    const p1 = ensureLineProtocol(db, l.id, "socks5", { startPort: 41443 });
    const p2 = ensureLineProtocol(db, l.id, "socks5", { startPort: 41443 });
    expect(p1).toBe(p2);
  });

  it("ensureLineProtocol does not allocate a port for wireguard", () => {
    const l = db.insert(lines).values({ name: "L" }).returning().get();
    const port = ensureLineProtocol(db, l.id, "wireguard", { startPort: 41443 });
    expect(port).toBeNull();
    expect(db.select().from(lineProtocols).all()).toHaveLength(1);
  });

  it("releaseLineProtocol removes the row", () => {
    const l = db.insert(lines).values({ name: "L" }).returning().get();
    ensureLineProtocol(db, l.id, "xray-wstls", { startPort: 41443 });
    releaseLineProtocol(db, l.id, "xray-wstls");
    expect(db.select().from(lineProtocols).all()).toHaveLength(0);
  });
});

describe("compatibility checks", () => {
  it("isProtocolSupportedByEntryNode returns true when row exists", () => {
    const node = db.insert(nodes).values({
      name: "n1", ip: "1.1.1.1", agentToken: "t",
      wgPrivateKey: "p", wgPublicKey: "pub", wgAddress: "10.210.0.1",
    }).returning().get();
    enableNodeProtocol(db, node.id, "xray-wstls", { tlsDomain: "x.com" });
    expect(isProtocolSupportedByEntryNode(db, node.id, "xray-wstls")).toBe(true);
    expect(isProtocolSupportedByEntryNode(db, node.id, "xray-reality")).toBe(false);
  });
});
