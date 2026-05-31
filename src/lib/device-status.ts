const DEVICE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// SOCKS5 / HTTP proxy devices are stateless connections — there is no
// handshake or persistent session to track, so they have no online/offline
// concept. They report status "-" (rendered as an em dash in the UI).
export const STATELESS_PROTOCOLS = new Set(["socks5", "http"]);

export type DeviceStatus = "online" | "offline" | "-";

export function isDeviceOnline(lastHandshake: string | null): boolean {
  if (!lastHandshake) return false;
  return Date.now() - new Date(lastHandshake).getTime() < DEVICE_ONLINE_THRESHOLD_MS;
}

export function computeDeviceStatus(
  lastHandshake: string | null,
  protocol?: string | null
): DeviceStatus {
  if (protocol && STATELESS_PROTOCOLS.has(protocol)) return "-";
  return isDeviceOnline(lastHandshake) ? "online" : "offline";
}
