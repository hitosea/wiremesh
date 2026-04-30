import { describe, it, expect } from "vitest";
import { buildV2RayUri, buildV2RaySubscription } from "@/lib/subscription/v2ray-builder";
import type { DeviceContext, EntryNodeContext } from "@/lib/subscription/types";

const baseEntry: EntryNodeContext = {
  id: 1, name: "edge", ip: "203.0.113.10", domain: null,
  wgPort: 41820, wgPublicKey: "ENTRYWGPUB", wgAddress: "10.210.0.1",
};

const realityEntry: EntryNodeContext = {
  ...baseEntry,
  xrayReality: {
    publicKey: "REALPUB",
    shortId: "abcd",
    dest: "www.microsoft.com:443",
    serverName: "www.microsoft.com",
  },
};

const wstlsEntry: EntryNodeContext = {
  ...baseEntry,
  xrayWsTls: {
    wsPath: "/ws",
    tlsDomain: "edge.example.com",
  },
};

const wg: DeviceContext = {
  id: 1, name: "phone", remark: null, protocol: "wireguard", lineId: 1,
  linePort: null, entry: baseEntry,
  wg: { privateKey: "PRIV", publicKey: "PUB", address: "10.210.0.100/32", addressIp: "10.210.0.100" },
};
const xrayReality: DeviceContext = {
  id: 2, name: "laptop", remark: null, protocol: "xray-reality", lineId: 1,
  linePort: 41443, entry: realityEntry,
  xray: { uuid: "uuid-1234" },
};
const xrayWsTls: DeviceContext = {
  id: 5, name: "tablet", remark: null, protocol: "xray-wstls", lineId: 2,
  linePort: 41445, entry: wstlsEntry,
  xray: { uuid: "uuid-wstls" },
};
const sock: DeviceContext = {
  id: 3, name: "router", remark: null, protocol: "socks5", lineId: 1,
  linePort: 41444, entry: baseEntry,
  socks5: { username: "user", password: "p@ss" },
};

describe("buildV2RayUri", () => {
  it("emits wg:// for WireGuard (modern V2RayN/NG/NekoBox accept it)", () => {
    const uri = buildV2RayUri(wg)!;
    expect(uri.startsWith("wg://")).toBe(true);
    expect(uri).toContain("publicKey=");
    expect(uri).toContain("privateKey=");
  });
  it("emits vless:// for xray-reality devices", () => {
    const uri = buildV2RayUri(xrayReality)!;
    expect(uri.startsWith("vless://uuid-1234@")).toBe(true);
    expect(uri).toContain("security=reality");
  });
  it("emits vless:// for xray-wstls devices", () => {
    const uri = buildV2RayUri(xrayWsTls)!;
    expect(uri.startsWith("vless://uuid-wstls@")).toBe(true);
    expect(uri).toContain("security=tls");
    expect(uri).toContain("type=ws");
  });
  it("emits socks5:// for SOCKS5 devices", () => {
    const uri = buildV2RayUri(sock)!;
    expect(uri.startsWith("socks5://")).toBe(true);
  });
});

describe("buildV2RaySubscription", () => {
  it("includes all four protocols (no devices skipped)", () => {
    const { body, skipped } = buildV2RaySubscription([wg, xrayReality, xrayWsTls, sock]);
    expect(skipped).toBe(0);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    const lines = decoded.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0].startsWith("wg://")).toBe(true);
    expect(lines[1].startsWith("vless://")).toBe(true);
    expect(lines[2].startsWith("vless://")).toBe(true);
    expect(lines[3].startsWith("socks5://")).toBe(true);
  });

  it("base64-encodes the joined URI list", () => {
    const { body } = buildV2RaySubscription([xrayReality, sock]);
    expect(body).toMatch(/^[A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    expect(decoded).toContain("vless://");
    expect(decoded).toContain("socks5://");
  });
});
