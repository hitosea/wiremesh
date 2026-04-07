const DEVICE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export function isDeviceOnline(lastHandshake: string | null): boolean {
  if (!lastHandshake) return false;
  return Date.now() - new Date(lastHandshake).getTime() < DEVICE_ONLINE_THRESHOLD_MS;
}

export function computeDeviceStatus(lastHandshake: string | null, protocol?: string): "online" | "offline" | "-" {
  // Xray devices don't have WireGuard handshakes, status unknown
  if (protocol === "xray") return "-";
  return isDeviceOnline(lastHandshake) ? "online" : "offline";
}
