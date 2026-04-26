import { describe, it, expect, beforeEach } from "vitest";
import {
  setNodeSnapshot,
  getNodeSnapshot,
  clearAllSnapshots,
  type TunnelStatusReport,
} from "@/lib/tunnel-status-cache";

describe("tunnel-status-cache", () => {
  beforeEach(() => {
    clearAllSnapshots();
  });

  it("returns null for unknown nodeId", () => {
    expect(getNodeSnapshot(999)).toBeNull();
  });

  it("stores and retrieves snapshot", () => {
    const tunnels: TunnelStatusReport[] = [
      { iface: "wm-tun11", peerPublicKey: "abc=", lastHandshake: 1777111630, rxBytes: 100, txBytes: 200 },
    ];
    setNodeSnapshot(5, tunnels);
    const got = getNodeSnapshot(5);
    expect(got).not.toBeNull();
    expect(got!.tunnels).toEqual(tunnels);
    expect(got!.reportedAt).toBeGreaterThan(0);
  });

  it("overwrites previous snapshot for same nodeId", () => {
    setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "a=", lastHandshake: 100, rxBytes: 0, txBytes: 0 }]);
    const firstAt = getNodeSnapshot(5)!.reportedAt;
    // wait at least 1s so reportedAt advances
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "b=", lastHandshake: 200, rxBytes: 1, txBytes: 2 }]);
        const second = getNodeSnapshot(5)!;
        expect(second.tunnels[0].peerPublicKey).toBe("b=");
        expect(second.reportedAt).toBeGreaterThanOrEqual(firstAt);
        resolve();
      }, 1100);
    });
  });

  it("isolates snapshots by nodeId", () => {
    setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "a=", lastHandshake: 100, rxBytes: 0, txBytes: 0 }]);
    setNodeSnapshot(6, [{ iface: "wm-tun11", peerPublicKey: "b=", lastHandshake: 200, rxBytes: 0, txBytes: 0 }]);
    expect(getNodeSnapshot(5)!.tunnels[0].peerPublicKey).toBe("a=");
    expect(getNodeSnapshot(6)!.tunnels[0].peerPublicKey).toBe("b=");
  });

  it("clearAllSnapshots empties the cache", () => {
    setNodeSnapshot(5, [{ iface: "wm-tun11", peerPublicKey: "a=", lastHandshake: 100, rxBytes: 0, txBytes: 0 }]);
    clearAllSnapshots();
    expect(getNodeSnapshot(5)).toBeNull();
  });
});
