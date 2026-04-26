import { describe, it, expect } from "vitest";
import { buildSingboxOutbound, buildSingboxOutbounds } from "@/lib/subscription/singbox-builder";
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
const xrayReality: DeviceContext = {
  id: 2, name: "laptop", remark: null, protocol: "xray", lineId: 1,
  lineXrayPort: 41443, lineSocks5Port: null, entry: baseEntry,
  xray: { uuid: "uuid-1234" },
};
const xrayWs: DeviceContext = {
  id: 3, name: "tablet", remark: null, protocol: "xray", lineId: 2,
  lineXrayPort: 41445, lineSocks5Port: null,
  entry: { ...baseEntry, xrayTransport: "ws-tls", xrayTlsDomain: "edge.example.com", xrayWsPath: "/ws" },
  xray: { uuid: "uuid-5678" },
};
const sock: DeviceContext = {
  id: 4, name: "router", remark: null, protocol: "socks5", lineId: 1,
  lineXrayPort: null, lineSocks5Port: 41444, entry: baseEntry,
  socks5: { username: "user", password: "p@ss" },
};

describe("buildSingboxOutbound", () => {
  it("WG → wireguard outbound with peer_public_key + local_address", () => {
    const ob = buildSingboxOutbound(wg)!;
    expect(ob.type).toBe("wireguard");
    expect(ob.tag).toBe("phone");
    expect(ob.server).toBe(baseEntry.ip);
    expect(ob.server_port).toBe(baseEntry.wgPort);
    expect(ob.private_key).toBe("PRIV");
    expect(ob.peer_public_key).toBe("ENTRYWGPUB");
    expect(ob.local_address).toEqual(["10.210.0.100/32"]);
  });

  it("Xray reality → vless outbound with reality block", () => {
    const ob = buildSingboxOutbound(xrayReality)!;
    expect(ob.type).toBe("vless");
    expect(ob.flow).toBe("xtls-rprx-vision");
    const tls = ob.tls as Record<string, unknown>;
    expect(tls.enabled).toBe(true);
    expect(tls.server_name).toBe("www.microsoft.com");
    expect((tls.reality as Record<string, unknown>).public_key).toBe("REALPUB");
  });

  it("Xray ws-tls → vless outbound with ws transport", () => {
    const ob = buildSingboxOutbound(xrayWs)!;
    expect(ob.type).toBe("vless");
    expect(ob.flow).toBe("");
    expect(ob.transport).toEqual({ type: "ws", path: "/ws", headers: { Host: "edge.example.com" } });
    expect(ob.server).toBe("edge.example.com");
  });

  it("SOCKS5 → socks outbound with version 5", () => {
    const ob = buildSingboxOutbound(sock)!;
    expect(ob.type).toBe("socks");
    expect(ob.version).toBe("5");
    expect(ob.username).toBe("user");
    expect(ob.password).toBe("p@ss");
    expect(ob.server_port).toBe(41444);
  });
});

describe("buildSingboxOutbounds", () => {
  it("dedupes tags", () => {
    const a = { ...wg };
    const b = { ...wg, id: 99 };
    const { outbounds } = buildSingboxOutbounds([a, b]);
    expect(outbounds.map((o) => o.tag)).toEqual(["phone", "phone-2"]);
  });

  it("includes all 3 protocols", () => {
    const { outbounds, skipped } = buildSingboxOutbounds([wg, xrayReality, sock]);
    expect(skipped).toBe(0);
    expect(outbounds).toHaveLength(3);
    expect(outbounds.map((o) => o.type)).toEqual(["wireguard", "vless", "socks"]);
  });
});
