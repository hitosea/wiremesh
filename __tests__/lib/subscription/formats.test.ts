import { describe, it, expect } from "vitest";
import { resolveFormat, ALL_CLIENT_IDS, FORMAT_PROTOCOL_SUPPORT } from "@/lib/subscription/formats";

describe("resolveFormat", () => {
  it("maps every advertised client to a known format", () => {
    for (const client of ALL_CLIENT_IDS) {
      expect(resolveFormat(client)).not.toBeNull();
    }
  });
  it("accepts canonical format names directly", () => {
    expect(resolveFormat("clash")).toBe("clash");
    expect(resolveFormat("v2ray")).toBe("v2ray");
    expect(resolveFormat("singbox")).toBe("singbox");
    expect(resolveFormat("shadowrocket")).toBe("shadowrocket");
  });
  it("is case-insensitive on the path slug", () => {
    expect(resolveFormat("ClashVerge")).toBe("clash");
    expect(resolveFormat("HIDDIFY")).toBe("singbox");
  });
  it("rejects unknown clients", () => {
    expect(resolveFormat("nekobox")).toBeNull();
    expect(resolveFormat("")).toBeNull();
  });
  it("v2ray is the only family that drops WG (V2Ray core has no WG outbound)", () => {
    expect(FORMAT_PROTOCOL_SUPPORT.v2ray.wireguard).toBe(false);
    expect(FORMAT_PROTOCOL_SUPPORT.clash.wireguard).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.shadowrocket.wireguard).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.singbox.wireguard).toBe(true);
  });
});
