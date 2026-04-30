import { describe, it, expect } from "vitest";
import { buildShadowrocketUri, buildShadowrocketSubscription } from "@/lib/subscription/shadowrocket-builder";
import type { DeviceContext, EntryNodeContext } from "@/lib/subscription/types";

const baseEntry: EntryNodeContext = {
  id: 1,
  name: "edge-hk",
  ip: "203.0.113.10",
  domain: null,
  wgPort: 41820,
  wgPublicKey: "ENTRYWGPUB+KEY/abc==",
  wgAddress: "10.210.0.1",
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
    wsPath: "/sub-ws",
    tlsDomain: "edge.example.com",
  },
};

const wg: DeviceContext = {
  id: 1, name: "phone", remark: null, protocol: "wireguard", lineId: 1,
  linePort: null, entry: baseEntry,
  wg: { privateKey: "PRIV+KEY/xyz==", publicKey: "PUB", address: "10.210.0.100/32", addressIp: "10.210.0.100" },
};
const vlessReality: DeviceContext = {
  id: 2, name: "laptop", remark: null, protocol: "xray-reality", lineId: 1,
  linePort: 41443, entry: realityEntry,
  xray: { uuid: "uuid-1234" },
};
const vlessWs: DeviceContext = {
  id: 3, name: "tablet", remark: null, protocol: "xray-wstls", lineId: 2,
  linePort: 41445, entry: wstlsEntry,
  xray: { uuid: "uuid-5678" },
};
const sock: DeviceContext = {
  id: 4, name: "router", remark: null, protocol: "socks5", lineId: 1,
  linePort: 41444, entry: baseEntry,
  socks5: { username: "user@x", password: "p:s" },
};

describe("buildShadowrocketUri — wireguard", () => {
  it("emits a Shadowrocket-compatible wg:// URI", () => {
    const uri = buildShadowrocketUri(wg)!;
    expect(uri.startsWith("wg://203.0.113.10:41820?")).toBe(true);
    expect(uri).toContain("publicKey=ENTRYWGPUB%2BKEY/abc%3D%3D");
    expect(uri).toContain("privateKey=PRIV%2BKEY/xyz%3D%3D");
    expect(uri).toContain("ip=10.210.0.100");
    expect(uri).toContain("dns=10.210.0.1");
    expect(uri).toContain("udp=1");
    expect(uri).toContain("mtu=1420");
    expect(uri.endsWith("#phone")).toBe(true);
  });

  it("uses domain when entry has one", () => {
    const ctx = { ...wg, entry: { ...baseEntry, domain: "edge.example.com" } };
    const uri = buildShadowrocketUri(ctx)!;
    expect(uri.startsWith("wg://edge.example.com:41820?")).toBe(true);
  });

  it("appends device.remark to the fragment when set", () => {
    const uri = buildShadowrocketUri({ ...wg, remark: "work" })!;
    expect(uri.endsWith("#phone%20(work)")).toBe(true);
  });
});

describe("buildShadowrocketUri — xray-reality", () => {
  it("VLESS reality emits standard vless:// share link", () => {
    const uri = buildShadowrocketUri(vlessReality)!;
    expect(uri.startsWith("vless://uuid-1234@203.0.113.10:41443?")).toBe(true);
    expect(uri).toContain("security=reality");
    expect(uri).toContain("pbk=REALPUB");
    expect(uri.endsWith("#laptop")).toBe(true);
  });
});

describe("buildShadowrocketUri — xray-wstls", () => {
  it("VLESS ws-tls uses tls security and ws type", () => {
    const uri = buildShadowrocketUri(vlessWs)!;
    expect(uri).toContain("security=tls");
    expect(uri).toContain("type=ws");
    expect(uri).toContain("@edge.example.com:41445");
  });

  it("VLESS ws-tls uses tlsDomain as server host", () => {
    const uri = buildShadowrocketUri(vlessWs)!;
    expect(uri.startsWith("vless://uuid-5678@edge.example.com:41445?")).toBe(true);
  });
});

describe("buildShadowrocketUri — socks5", () => {
  it("SOCKS5 percent-encodes user:pass payload", () => {
    const uri = buildShadowrocketUri(sock)!;
    expect(uri.startsWith("socks5://user%40x%3Ap%3As@")).toBe(true);
    expect(uri.endsWith("#router")).toBe(true);
  });
});

describe("buildShadowrocketSubscription", () => {
  it("base64-encodes the URI list with CRLF line separators", () => {
    const { body, skipped } = buildShadowrocketSubscription([wg, vlessReality, sock]);
    expect(skipped).toBe(0);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    const lines = decoded.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("wg://")).toBe(true);
    expect(lines[1].startsWith("vless://")).toBe(true);
    expect(lines[2].startsWith("socks5://")).toBe(true);
  });

  it("includes xray-wstls in subscription", () => {
    const { body, skipped } = buildShadowrocketSubscription([vlessReality, vlessWs, sock]);
    expect(skipped).toBe(0);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    const lines = decoded.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("vless://")).toBe(true);
    expect(lines[1].startsWith("vless://")).toBe(true);
    expect(lines[2].startsWith("socks5://")).toBe(true);
  });

  it("prepends a STATUS line when one is supplied", () => {
    const status = "STATUS=↑:1.00GB,↓:2.00GB,✓:∞,〇:∞,⊖:∞";
    const { body } = buildShadowrocketSubscription([sock], status);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    const lines = decoded.split("\r\n");
    expect(lines[0]).toBe(status);
    expect(lines[1].startsWith("socks5://")).toBe(true);
  });

  it("skips devices that produce null", () => {
    const broken: DeviceContext = {
      ...vlessReality,
      entry: { ...realityEntry, xrayReality: { publicKey: "", shortId: "abcd", dest: "", serverName: "www.microsoft.com" } },
    };
    const { body, skipped } = buildShadowrocketSubscription([broken, sock]);
    expect(skipped).toBe(1);
    const decoded = Buffer.from(body, "base64").toString("utf8");
    expect(decoded.split("\r\n")).toHaveLength(1);
    expect(decoded).toContain("socks5://");
  });
});
