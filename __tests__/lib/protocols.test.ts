import { describe, it, expect } from "vitest";
import {
  DEVICE_PROTOCOLS,
  isXrayProtocol,
  deviceProtocolToTransport,
  transportToDeviceProtocol,
} from "@/lib/protocols";

describe("protocols", () => {
  it("DEVICE_PROTOCOLS contains the four expected values", () => {
    expect(DEVICE_PROTOCOLS).toEqual([
      "wireguard",
      "xray-reality",
      "xray-wstls",
      "socks5",
    ]);
  });

  it("isXrayProtocol identifies xray-reality and xray-wstls", () => {
    expect(isXrayProtocol("xray-reality")).toBe(true);
    expect(isXrayProtocol("xray-wstls")).toBe(true);
    expect(isXrayProtocol("wireguard")).toBe(false);
    expect(isXrayProtocol("socks5")).toBe(false);
  });

  it("deviceProtocolToTransport maps to agent transport values", () => {
    expect(deviceProtocolToTransport("xray-reality")).toBe("reality");
    expect(deviceProtocolToTransport("xray-wstls")).toBe("ws-tls");
    expect(deviceProtocolToTransport("wireguard")).toBeNull();
    expect(deviceProtocolToTransport("socks5")).toBeNull();
  });

  it("transportToDeviceProtocol is the inverse for xray", () => {
    expect(transportToDeviceProtocol("reality")).toBe("xray-reality");
    expect(transportToDeviceProtocol("ws-tls")).toBe("xray-wstls");
  });
});
