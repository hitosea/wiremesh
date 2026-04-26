import { describe, it, expect } from "vitest";
import { buildV2RayUri, buildV2RaySubscription } from "@/lib/subscription/v2ray-builder";
import type { DeviceContext, EntryNodeContext } from "@/lib/subscription/types";

const baseEntry: EntryNodeContext = {
  id: 1, name: "edge", ip: "203.0.113.10", domain: null,
  wgPort: 41820, wgPublicKey: "ENTRYWGPUB", wgAddress: "10.210.0.1",
  xrayPort: 41443, xrayTransport: "reality", xrayTlsDomain: null, xrayWsPath: null,
  realityPublicKey: "REALPUB", realityShortId: "abcd", realityServerName: "www.microsoft.com",
};

const wg: DeviceContext = {
  id: 1, name: "phone", remark: null, protocol: "wireguard", lineId: 1,
  lineXrayPort: 41443, lineSocks5Port: 41444, entry: baseEntry,
  wg: { privateKey: "PRIV", publicKey: "PUB", address: "10.210.0.100/32", addressIp: "10.210.0.100" },
};
const xray: DeviceContext = {
  id: 2, name: "laptop", remark: null, protocol: "xray", lineId: 1,
  lineXrayPort: 41443, lineSocks5Port: null, entry: baseEntry,
  xray: { uuid: "uuid-1234" },
};
const sock: DeviceContext = {
  id: 3, name: "router", remark: null, protocol: "socks5", lineId: 1,
  lineXrayPort: null, lineSocks5Port: 41444, entry: baseEntry,
  socks5: { username: "user", password: "p@ss" },
};

describe("buildV2RayUri", () => {
  it("returns null for WireGuard (V2Ray core has no WG outbound)", () => {
    expect(buildV2RayUri(wg)).toBeNull();
  });
  it("emits vless:// for Xray devices", () => {
    const uri = buildV2RayUri(xray)!;
    expect(uri.startsWith("vless://uuid-1234@")).toBe(true);
  });
  it("emits socks5:// for SOCKS5 devices", () => {
    const uri = buildV2RayUri(sock)!;
    expect(uri.startsWith("socks5://")).toBe(true);
  });
});

describe("buildV2RaySubscription", () => {
  it("counts WireGuard devices as skipped", () => {
    const { body, skipped } = buildV2RaySubscription([wg, xray, sock]);
    expect(skipped).toBe(1);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    const lines = decoded.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("vless://")).toBe(true);
    expect(lines[1].startsWith("socks5://")).toBe(true);
  });

  it("base64-encodes the joined URI list", () => {
    const { body } = buildV2RaySubscription([xray, sock]);
    expect(body).toMatch(/^[A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    expect(decoded).toContain("vless://");
    expect(decoded).toContain("socks5://");
  });
});
