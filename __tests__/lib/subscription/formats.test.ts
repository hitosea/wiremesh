import { describe, it, expect } from "vitest";
import { resolveFormat, ALL_CLIENT_IDS, FORMAT_PROTOCOL_SUPPORT, clientI18nKey } from "@/lib/subscription/formats";

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
  it("singbox-1.12 (with dot in URL slug) resolves to singbox format", () => {
    expect(resolveFormat("singbox-1.12")).toBe("singbox");
  });
  it("clientI18nKey replaces dots so next-intl can index it", () => {
    expect(clientI18nKey("singbox-1.12")).toBe("singbox-1_12");
    expect(clientI18nKey("hiddify")).toBe("hiddify");
  });
  it("all four formats now claim WG support (v2ray emits wg:// since modern V2RayN/NG/NekoBox accept it)", () => {
    expect(FORMAT_PROTOCOL_SUPPORT.v2ray.wireguard).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.clash.wireguard).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.shadowrocket.wireguard).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.singbox.wireguard).toBe(true);
  });
  it("all four formats support xray-reality", () => {
    expect(FORMAT_PROTOCOL_SUPPORT.clash["xray-reality"]).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.shadowrocket["xray-reality"]).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.v2ray["xray-reality"]).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.singbox["xray-reality"]).toBe(true);
  });
  it("all four formats support xray-wstls", () => {
    expect(FORMAT_PROTOCOL_SUPPORT.clash["xray-wstls"]).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.shadowrocket["xray-wstls"]).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.v2ray["xray-wstls"]).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.singbox["xray-wstls"]).toBe(true);
  });
  it("all four formats support socks5", () => {
    expect(FORMAT_PROTOCOL_SUPPORT.clash.socks5).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.shadowrocket.socks5).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.v2ray.socks5).toBe(true);
    expect(FORMAT_PROTOCOL_SUPPORT.singbox.socks5).toBe(true);
  });
});
