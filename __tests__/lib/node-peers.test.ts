import { describe, it, expect } from "vitest";
import { pickPeerNodeIds } from "@/lib/node-peers";

describe("pickPeerNodeIds", () => {
  it("returns empty for no tunnels", () => {
    expect(pickPeerNodeIds([], 1)).toEqual([]);
  });

  it("collects the other endpoint of each tunnel", () => {
    const rows = [
      { fromNodeId: 1, toNodeId: 2 },
      { fromNodeId: 1, toNodeId: 3 },
    ];
    expect(pickPeerNodeIds(rows, 1).sort()).toEqual([2, 3]);
  });

  it("works when the node is the to-side", () => {
    const rows = [
      { fromNodeId: 5, toNodeId: 1 },
      { fromNodeId: 7, toNodeId: 1 },
    ];
    expect(pickPeerNodeIds(rows, 1).sort()).toEqual([5, 7]);
  });

  it("dedupes when the same peer appears in multiple tunnels", () => {
    const rows = [
      { fromNodeId: 1, toNodeId: 2 },
      { fromNodeId: 2, toNodeId: 1 },
      { fromNodeId: 1, toNodeId: 2 },
    ];
    expect(pickPeerNodeIds(rows, 1)).toEqual([2]);
  });

  it("excludes the node itself when it appears as both endpoints (defensive)", () => {
    const rows = [
      { fromNodeId: 1, toNodeId: 1 },
      { fromNodeId: 1, toNodeId: 4 },
    ];
    expect(pickPeerNodeIds(rows, 1)).toEqual([4]);
  });

  it("handles a relay node that is from-side on one tunnel and to-side on another", () => {
    const rows = [
      { fromNodeId: 1, toNodeId: 2 }, // 2 is to-side here
      { fromNodeId: 2, toNodeId: 3 }, // 2 is from-side here
    ];
    expect(pickPeerNodeIds(rows, 2).sort()).toEqual([1, 3]);
  });
});
