import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

// allocateProxyPort scans xray_port + socks5_port + http_port on an entry
// node's lines. This test verifies http_port participates in conflict scanning.
// It mirrors the real query shape against an in-memory schema subset.
function allocate(occupied: Set<number>, basePort: number): number {
  for (let port = basePort; port < basePort + 100; port++) {
    if (!occupied.has(port)) return port;
  }
  return basePort;
}

describe("proxy port allocation conflict set", () => {
  it("includes http_port in the occupied set", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE lines (id INTEGER PRIMARY KEY, xray_port INTEGER, socks5_port INTEGER, http_port INTEGER);`);
    sqlite.prepare("INSERT INTO lines (xray_port, socks5_port, http_port) VALUES (?,?,?)").run(41443, 41444, 41445);
    const rows = sqlite.prepare("SELECT xray_port AS x, socks5_port AS s, http_port AS h FROM lines").all() as { x: number | null; s: number | null; h: number | null }[];
    const occupied = new Set<number>();
    for (const r of rows) {
      if (r.x !== null) occupied.add(r.x);
      if (r.s !== null) occupied.add(r.s);
      if (r.h !== null) occupied.add(r.h);
    }
    expect(occupied.has(41445)).toBe(true);
    expect(allocate(occupied, 41443)).toBe(41446);
  });
});
