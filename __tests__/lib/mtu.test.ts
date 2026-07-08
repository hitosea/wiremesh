import { describe, expect, it } from "vitest";
import { BUILTIN_DEFAULT_MTU, effectiveTunnelMtu, parseMtu, resolveNodeMtu } from "@/lib/mtu";

describe("mtu helpers", () => {
  it("parses only supported MTU values", () => {
    expect(parseMtu(1380)).toBe(1380);
    expect(parseMtu("1420")).toBe(1420);
    expect(parseMtu("")).toBeNull();
    expect(parseMtu("1279")).toBeNull();
    expect(parseMtu("9001")).toBeNull();
    expect(parseMtu("1380px")).toBeNull();
  });

  it("resolves node MTU from node value, system default, then built-in default", () => {
    expect(resolveNodeMtu(1360, "1380")).toBe(1360);
    expect(resolveNodeMtu(null, "1380")).toBe(1380);
    expect(resolveNodeMtu(undefined, undefined)).toBe(BUILTIN_DEFAULT_MTU);
  });

  it("uses the smaller resolved node MTU for a tunnel", () => {
    expect(effectiveTunnelMtu(1420, 1380, null)).toBe(1380);
    expect(effectiveTunnelMtu(null, 1420, "1360")).toBe(1360);
    expect(effectiveTunnelMtu(null, null, null)).toBe(BUILTIN_DEFAULT_MTU);
  });
});
