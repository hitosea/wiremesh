import { describe, it, expect } from "vitest";
import {
  allocateNodeIp,
  allocateDeviceIp,
  allocateTunnelSubnet,
  allocateTunnelPort,
  parseTunnelPortBlacklist,
} from "@/lib/ip-allocator";

describe("ip-allocator", () => {
  describe("allocateNodeIp", () => {
    it("returns first available IP from startPos", () => {
      const result = allocateNodeIp([], "10.0.0.0/24", 1);
      expect(result).toBe("10.0.0.1/24");
    });

    it("skips used addresses", () => {
      const used = ["10.0.0.1/24", "10.0.0.2/24"];
      const result = allocateNodeIp(used, "10.0.0.0/24", 1);
      expect(result).toBe("10.0.0.3/24");
    });

    it("handles addresses without subnet mask in used list", () => {
      const used = ["10.0.0.1"];
      const result = allocateNodeIp(used, "10.0.0.0/24", 1);
      expect(result).toBe("10.0.0.2/24");
    });

    it("starts from the specified startPos", () => {
      const result = allocateNodeIp([], "10.0.0.0/24", 5);
      expect(result).toBe("10.0.0.5/24");
    });

    it("throws when range is exhausted", () => {
      const used = Array.from({ length: 254 }, (_, i) => `10.0.0.${i + 1}`);
      expect(() => allocateNodeIp(used, "10.0.0.0/24", 1)).toThrow(
        "No available IP addresses in node range"
      );
    });
  });

  describe("allocateDeviceIp", () => {
    it("returns first available IP from startPos", () => {
      const result = allocateDeviceIp([], "10.0.0.0/24", 100);
      expect(result).toBe("10.0.0.100/24");
    });

    it("skips used addresses", () => {
      const used = ["10.0.0.100", "10.0.0.101", "10.0.0.102"];
      const result = allocateDeviceIp(used, "10.0.0.0/24", 100);
      expect(result).toBe("10.0.0.103/24");
    });

    it("throws when device range is exhausted", () => {
      const used = Array.from({ length: 155 }, (_, i) => `10.0.0.${i + 100}`);
      expect(() => allocateDeviceIp(used, "10.0.0.0/24", 100)).toThrow(
        "No available IP addresses in device range"
      );
    });
  });

  describe("allocateTunnelSubnet", () => {
    it("returns first /30 subnet with .1 and .2 addresses", () => {
      const result = allocateTunnelSubnet([], "10.1.0.0/16");
      expect(result.fromAddress).toBe("10.1.0.1/30");
      expect(result.toAddress).toBe("10.1.0.2/30");
    });

    it("skips /30 subnets where fromAddress is used", () => {
      const used = ["10.1.0.1/30"];
      const result = allocateTunnelSubnet(used, "10.1.0.0/16");
      expect(result.fromAddress).toBe("10.1.0.5/30");
      expect(result.toAddress).toBe("10.1.0.6/30");
    });

    it("skips /30 subnets where toAddress is used", () => {
      const used = ["10.1.0.2"];
      const result = allocateTunnelSubnet(used, "10.1.0.0/16");
      expect(result.fromAddress).toBe("10.1.0.5/30");
      expect(result.toAddress).toBe("10.1.0.6/30");
    });

    it("allocates sequential /30 subnets correctly", () => {
      const used = ["10.1.0.1", "10.1.0.2", "10.1.0.5", "10.1.0.6"];
      const result = allocateTunnelSubnet(used, "10.1.0.0/16");
      expect(result.fromAddress).toBe("10.1.0.9/30");
      expect(result.toAddress).toBe("10.1.0.10/30");
    });
  });

  describe("allocateTunnelPort", () => {
    it("returns startPort when no ports are used", () => {
      expect(allocateTunnelPort([], 51820)).toBe(51820);
    });

    it("skips used ports", () => {
      expect(allocateTunnelPort([51820, 51821], 51820)).toBe(51822);
    });

    it("finds gap in non-contiguous used ports", () => {
      expect(allocateTunnelPort([51820, 51822], 51820)).toBe(51821);
    });

    it("throws when no ports available", () => {
      const used = Array.from({ length: 65534 }, (_, i) => i + 1);
      expect(() => allocateTunnelPort(used, 1)).toThrow("No available tunnel ports");
    });

    it("skips blacklisted ports", () => {
      const blacklist = new Set([51820, 51821]);
      expect(allocateTunnelPort([], 51820, blacklist)).toBe(51822);
    });

    it("skips both used and blacklisted ports", () => {
      const blacklist = new Set([51822]);
      expect(allocateTunnelPort([51820, 51821], 51820, blacklist)).toBe(51823);
    });

    it("treats empty blacklist same as no blacklist arg", () => {
      const blacklist = new Set<number>();
      expect(allocateTunnelPort([51820], 51820, blacklist)).toBe(51821);
    });
  });

  describe("parseTunnelPortBlacklist", () => {
    it("returns empty array for empty string", () => {
      expect(parseTunnelPortBlacklist("")).toEqual([]);
    });

    it("parses comma-separated ports", () => {
      expect(parseTunnelPortBlacklist("41834,41835,41840")).toEqual([41834, 41835, 41840]);
    });

    it("trims whitespace", () => {
      expect(parseTunnelPortBlacklist(" 41834 , 41835 ")).toEqual([41834, 41835]);
    });

    it("filters out invalid entries (non-numeric, out of range)", () => {
      expect(parseTunnelPortBlacklist("41834,abc,99999,0,-5,41835")).toEqual([41834, 41835]);
    });
  });
});
