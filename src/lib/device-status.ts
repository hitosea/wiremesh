const DEVICE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export function isDeviceOnline(lastHandshake: string | null): boolean {
  if (!lastHandshake) return false;
  return Date.now() - new Date(lastHandshake).getTime() < DEVICE_ONLINE_THRESHOLD_MS;
}

export function computeDeviceStatus(lastHandshake: string | null): "online" | "offline" {
  return isDeviceOnline(lastHandshake) ? "online" : "offline";
}
