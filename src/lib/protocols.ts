export const DEVICE_PROTOCOLS = [
  "wireguard",
  "xray-reality",
  "xray-wstls",
  "socks5",
] as const;

export type DeviceProtocol = (typeof DEVICE_PROTOCOLS)[number];
export type XrayTransport = "reality" | "ws-tls";

export function isXrayProtocol(p: string): p is "xray-reality" | "xray-wstls" {
  return p === "xray-reality" || p === "xray-wstls";
}

export function deviceProtocolToTransport(p: DeviceProtocol): XrayTransport | null {
  if (p === "xray-reality") return "reality";
  if (p === "xray-wstls") return "ws-tls";
  return null;
}

export function transportToDeviceProtocol(t: XrayTransport): "xray-reality" | "xray-wstls" {
  return t === "reality" ? "xray-reality" : "xray-wstls";
}
