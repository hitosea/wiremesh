import { db } from "@/lib/db";
import { devices, subscriptionGroupDevices } from "@/lib/db/schema";
import { eq, sum } from "drizzle-orm";

export type GroupTraffic = { upload: number; download: number };

export function loadGroupTraffic(groupId: number): GroupTraffic {
  const row = db
    .select({
      upload: sum(devices.uploadBytes),
      download: sum(devices.downloadBytes),
    })
    .from(subscriptionGroupDevices)
    .innerJoin(devices, eq(subscriptionGroupDevices.deviceId, devices.id))
    .where(eq(subscriptionGroupDevices.groupId, groupId))
    .get();

  return {
    upload: Number(row?.upload ?? 0),
    download: Number(row?.download ?? 0),
  };
}

/**
 * Format a Subscription-Userinfo header (Clash / sing-box / V2RayN/G convention).
 * total=0 and expire=0 signal "unlimited / no expire" in most clients.
 */
export function formatSubscriptionUserinfo(t: GroupTraffic): string {
  return `upload=${t.upload}; download=${t.download}; total=0; expire=0`;
}

function formatGB(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/**
 * Format a Shadowrocket STATUS prefix line (SR-specific).
 * Per the SR convention: ↑ upload, ↓ download, ✓ remaining, 〇 total, ⊖ expire.
 * For self-hosted (no quota) we emit ∞ for the last three.
 */
export function formatShadowrocketStatusLine(t: GroupTraffic): string {
  return `STATUS=↑:${formatGB(t.upload)},↓:${formatGB(t.download)},✓:∞,〇:∞,⊖:∞`;
}
