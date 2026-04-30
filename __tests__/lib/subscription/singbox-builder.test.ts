import { describe, it, expect } from "vitest";
import { buildSingboxOutbound, buildSingboxOutbounds } from "@/lib/subscription/singbox-builder";
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
const xrayWs: DeviceContext = {
  id: 3, name: "tablet", remark: null, protocol: "xray-wstls", lineId: 2,
  linePort: 41445, entry: wstlsEntry,
  xray: { uuid: "uuid-5678" },
};
const sock: DeviceContext = {
  id: 4, name: "router", remark: null, protocol: "socks5", lineId: 1,
  linePort: 41444, entry: baseEntry,
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

  it("xray-reality → vless outbound with reality block + packet_encoding", () => {
    const ob = buildSingboxOutbound(xrayReality)!;
    expect(ob.type).toBe("vless");
    expect(ob.flow).toBe("xtls-rprx-vision");
    expect(ob.packet_encoding).toBe("packetaddr");
    const tls = ob.tls as Record<string, unknown>;
    expect(tls.enabled).toBe(true);
    expect(tls.server_name).toBe("www.microsoft.com");
    expect((tls.reality as Record<string, unknown>).public_key).toBe("REALPUB");
  });

  it("xray-wstls → vless outbound with ws transport + packet_encoding", () => {
    const ob = buildSingboxOutbound(xrayWs)!;
    expect(ob.type).toBe("vless");
    expect(ob.flow).toBe("");
    expect(ob.packet_encoding).toBe("packetaddr");
    expect(ob.transport).toEqual({ type: "ws", path: "/ws", headers: { Host: "edge.example.com" } });
    expect(ob.server).toBe("edge.example.com");
    expect(ob.server_port).toBe(41445);
  });

  it("SOCKS5 → socks outbound with version 5", () => {
    const ob = buildSingboxOutbound(sock)!;
    expect(ob.type).toBe("socks");
    expect(ob.version).toBe("5");
    expect(ob.username).toBe("user");
    expect(ob.password).toBe("p@ss");
    expect(ob.server_port).toBe(41444);
  });

  it("xray-reality returns null when linePort is null", () => {
    const ctx: DeviceContext = { ...xrayReality, linePort: null };
    expect(buildSingboxOutbound(ctx)).toBeNull();
  });

  it("xray-wstls returns null when linePort is null", () => {
    const ctx: DeviceContext = { ...xrayWs, linePort: null };
    expect(buildSingboxOutbound(ctx)).toBeNull();
  });
});

describe("buildSingboxOutbounds", () => {
  it("dedupes tags", () => {
    const a = { ...wg };
    const b = { ...wg, id: 99 };
    const { outbounds } = buildSingboxOutbounds([a, b]);
    expect(outbounds.map((o) => o.tag)).toEqual(["phone", "phone-2"]);
  });

  it("includes all 4 protocols", () => {
    const { outbounds, skipped } = buildSingboxOutbounds([wg, xrayReality, xrayWs, sock]);
    expect(skipped).toBe(0);
    expect(outbounds).toHaveLength(4);
    expect(outbounds.map((o) => o.type)).toEqual(["wireguard", "vless", "vless", "socks"]);
  });
});
