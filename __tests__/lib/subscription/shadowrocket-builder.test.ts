import { describe, it, expect } from "vitest";
import { buildShadowrocketUri, buildShadowrocketSubscription } from "@/lib/subscription/shadowrocket-builder";
import type { DeviceContext, EntryNodeContext } from "@/lib/subscription/types";

const baseEntry: EntryNodeContext = {
  id: 1,
  name: "edge-hk",
  ip: "203.0.113.10",
  domain: null,
  wgPort: 41820,
  wgPublicKey: "ENTRYWGPUBLICKEY",
  wgAddress: "10.210.0.1",
  xrayPort: 41443,
  xrayTransport: "reality",
  xrayTlsDomain: null,
  xrayWsPath: null,
  realityPublicKey: "REALPUB",
  realityShortId: "abcd",
  realityServerName: "www.microsoft.com",
};

const wg: DeviceContext = {
  id: 1, name: "phone", protocol: "wireguard", lineId: 1,
  lineXrayPort: 41443, lineSocks5Port: 41444, entry: baseEntry,
  wg: { privateKey: "PRIV", publicKey: "PUB", address: "10.210.0.100/32", addressIp: "10.210.0.100" },
};
const vlessReality: DeviceContext = {
  id: 2, name: "laptop", protocol: "xray", lineId: 1,
  lineXrayPort: 41443, lineSocks5Port: null, entry: baseEntry,
  xray: { uuid: "uuid-1234" },
};
const vlessWs: DeviceContext = {
  id: 3, name: "tablet", protocol: "xray", lineId: 2,
  lineXrayPort: 41445, lineSocks5Port: null,
  entry: { ...baseEntry, xrayTransport: "ws-tls", xrayTlsDomain: "edge.example.com", xrayWsPath: "/sub-ws" },
  xray: { uuid: "uuid-5678" },
};
const sock: DeviceContext = {
  id: 4, name: "router", protocol: "socks5", lineId: 1,
  lineXrayPort: null, lineSocks5Port: 41444, entry: baseEntry,
  socks5: { username: "user@x", password: "p:s" },
};

describe("buildShadowrocketUri", () => {
  it("WireGuard becomes wireguard:// with base64 conf body and named fragment", () => {
    const uri = buildShadowrocketUri(wg)!;
    expect(uri.startsWith("wireguard://")).toBe(true);
    expect(uri.endsWith("#phone")).toBe(true);
    const b64 = uri.slice("wireguard://".length, uri.indexOf("#"));
    const conf = Buffer.from(b64, "base64").toString("utf8");
    expect(conf).toContain("[Interface]");
    expect(conf).toContain("PrivateKey = PRIV");
    expect(conf).toContain("Endpoint = 203.0.113.10:41820");
  });

  it("VLESS reality emits standard vless:// share link with reality params", () => {
    const uri = buildShadowrocketUri(vlessReality)!;
    expect(uri.startsWith("vless://uuid-1234@203.0.113.10:41443?")).toBe(true);
    expect(uri).toContain("security=reality");
    expect(uri).toContain("pbk=REALPUB");
    expect(uri).toContain("sid=abcd");
    expect(uri.endsWith("#laptop")).toBe(true);
  });

  it("VLESS ws-tls uses tls security and ws type", () => {
    const uri = buildShadowrocketUri(vlessWs)!;
    expect(uri).toContain("security=tls");
    expect(uri).toContain("type=ws");
    expect(uri).toContain("path=%2Fsub-ws");
    expect(uri).toContain("@edge.example.com:41445");
  });

  it("SOCKS5 percent-encodes user:pass payload", () => {
    const uri = buildShadowrocketUri(sock)!;
    expect(uri.startsWith("socks5://")).toBe(true);
    // user@x and p:s contain reserved chars and must be encoded
    expect(uri).toContain("user%40x%3Ap%3As@");
    expect(uri.endsWith("#router")).toBe(true);
  });
});

describe("buildShadowrocketSubscription", () => {
  it("base64-encodes the joined URI list", () => {
    const { body, skipped } = buildShadowrocketSubscription([wg, vlessReality, sock]);
    expect(skipped).toBe(0);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    const lines = decoded.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("wireguard://")).toBe(true);
    expect(lines[1].startsWith("vless://")).toBe(true);
    expect(lines[2].startsWith("socks5://")).toBe(true);
  });

  it("skips devices that produce null", () => {
    const broken: DeviceContext = { ...vlessReality, entry: { ...baseEntry, realityPublicKey: null } };
    const { body, skipped } = buildShadowrocketSubscription([broken, sock]);
    expect(skipped).toBe(1);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    expect(decoded.split("\n")).toHaveLength(1);
    expect(decoded).toContain("socks5://");
  });
});
