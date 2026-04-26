import { describe, it, expect } from "vitest";
import { buildClashProxy, buildClashProxies, sanitizeProxyName } from "@/lib/subscription/clash-builder";
import type { DeviceContext, EntryNodeContext } from "@/lib/subscription/types";

const baseEntry: EntryNodeContext = {
  id: 1,
  name: "edge-hk",
  ip: "203.0.113.10",
  domain: null,
  wgPort: 41820,
  wgPublicKey: "ENTRYWGPUBLICKEY=================",
  wgAddress: "10.210.0.1",
  xrayPort: 41443,
  xrayTransport: "reality",
  xrayTlsDomain: null,
  xrayWsPath: null,
  realityPublicKey: "REALPUB",
  realityShortId: "abcd",
  realityServerName: "www.microsoft.com",
};

function wgCtx(): DeviceContext {
  return {
    id: 10,
    name: "phone",
    remark: null,
    protocol: "wireguard",
    lineId: 1,
    lineXrayPort: 41443,
    lineSocks5Port: 41444,
    entry: baseEntry,
    wg: {
      privateKey: "DEVICEPRIVATEKEY",
      publicKey: "DEVICEPUBLICKEY",
      address: "10.210.0.100/32",
      addressIp: "10.210.0.100",
    },
  };
}

function xrayRealityCtx(): DeviceContext {
  return {
    id: 11,
    name: "laptop",
    remark: null,
    protocol: "xray",
    lineId: 1,
    lineXrayPort: 41443,
    lineSocks5Port: null,
    entry: baseEntry,
    xray: { uuid: "11111111-2222-3333-4444-555555555555" },
  };
}

function xrayWsCtx(): DeviceContext {
  return {
    id: 12,
    name: "tablet",
    remark: null,
    protocol: "xray",
    lineId: 2,
    lineXrayPort: 41445,
    lineSocks5Port: null,
    entry: {
      ...baseEntry,
      xrayTransport: "ws-tls",
      xrayTlsDomain: "edge.example.com",
      xrayWsPath: "/sub-ws",
    },
    xray: { uuid: "11111111-2222-3333-4444-555555555555" },
  };
}

function socks5Ctx(): DeviceContext {
  return {
    id: 13,
    name: "router",
    remark: null,
    protocol: "socks5",
    lineId: 1,
    lineXrayPort: null,
    lineSocks5Port: 41444,
    entry: baseEntry,
    socks5: { username: "user", password: "p@ss" },
  };
}

describe("sanitizeProxyName", () => {
  it("replaces YAML-unsafe punctuation", () => {
    expect(sanitizeProxyName("a, b: c#d", "x")).toBe("a_ b_ c_d");
  });
  it("falls back when input is whitespace-only", () => {
    expect(sanitizeProxyName("   ", "fallback")).toBe("fallback");
  });
});

describe("buildClashProxy — wireguard", () => {
  it("emits a Clash wireguard proxy with all required fields", () => {
    const p = buildClashProxy(wgCtx())!;
    expect(p.type).toBe("wireguard");
    expect(p.server).toBe(baseEntry.ip);
    expect(p.port).toBe(baseEntry.wgPort);
    expect(p.ip).toBe("10.210.0.100");
    expect(p["private-key"]).toBe("DEVICEPRIVATEKEY");
    expect(p["public-key"]).toBe(baseEntry.wgPublicKey);
    expect(p["allowed-ips"]).toEqual(["0.0.0.0/0", "::/0"]);
    expect(p.dns).toEqual([baseEntry.wgAddress]);
    expect(p.udp).toBe(true);
  });

  it("prefers entry domain over ip for server", () => {
    const ctx = { ...wgCtx(), entry: { ...baseEntry, domain: "edge.example.com" } };
    const p = buildClashProxy(ctx)!;
    expect(p.server).toBe("edge.example.com");
  });
});

describe("buildClashProxy — xray reality", () => {
  it("emits a vless reality proxy on tcp", () => {
    const p = buildClashProxy(xrayRealityCtx())!;
    expect(p.type).toBe("vless");
    expect(p.network).toBe("tcp");
    expect(p.tls).toBe(true);
    expect(p.flow).toBe("xtls-rprx-vision");
    expect(p.servername).toBe("www.microsoft.com");
    expect(p.port).toBe(41443);
    expect(p["reality-opts"]).toEqual({ "public-key": "REALPUB", "short-id": "abcd" });
  });

  it("returns null when reality public key missing", () => {
    const ctx = xrayRealityCtx();
    ctx.entry = { ...ctx.entry, realityPublicKey: null };
    expect(buildClashProxy(ctx)).toBeNull();
  });
});

describe("buildClashProxy — xray ws-tls", () => {
  it("emits a vless ws-tls proxy with ws-opts host header", () => {
    const p = buildClashProxy(xrayWsCtx())!;
    expect(p.type).toBe("vless");
    expect(p.network).toBe("ws");
    expect(p.tls).toBe(true);
    expect(p.server).toBe("edge.example.com");
    expect(p["ws-opts"]).toEqual({ path: "/sub-ws", headers: { Host: "edge.example.com" } });
  });
});

describe("buildClashProxy — socks5", () => {
  it("emits a socks5 proxy on the line socks5 port", () => {
    const p = buildClashProxy(socks5Ctx())!;
    expect(p.type).toBe("socks5");
    expect(p.port).toBe(41444);
    expect(p.username).toBe("user");
    expect(p.password).toBe("p@ss");
  });
});

describe("buildClashProxies", () => {
  it("deduplicates proxy names", () => {
    const a = wgCtx();
    const b = wgCtx();
    b.id = 99;
    // both have name "phone" — second should become "phone-2"
    const { proxies } = buildClashProxies([a, b]);
    expect(proxies.map((p) => p.name)).toEqual(["phone", "phone-2"]);
  });

  it("includes device.remark in the proxy display name", () => {
    const ctx = wgCtx();
    ctx.remark = "work";
    const p = buildClashProxy(ctx)!;
    expect(p.name).toBe("phone (work)");
  });

  it("skips devices that produce null and reports skipped count", () => {
    const broken = xrayRealityCtx();
    broken.entry = { ...broken.entry, realityPublicKey: null };
    const { proxies, skipped } = buildClashProxies([wgCtx(), broken]);
    expect(proxies).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
