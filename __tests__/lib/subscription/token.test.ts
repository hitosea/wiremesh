import { describe, it, expect } from "vitest";
import { generateSubscriptionToken, isValidTokenShape } from "@/lib/subscription/token";

describe("subscription token", () => {
  it("generates a 43-char base64url token (32 bytes, no padding)", () => {
    const t = generateSubscriptionToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("subsequent generations differ", () => {
    const a = generateSubscriptionToken();
    const b = generateSubscriptionToken();
    expect(a).not.toBe(b);
  });

  it("isValidTokenShape rejects bad inputs", () => {
    expect(isValidTokenShape("short")).toBe(false);
    expect(isValidTokenShape("a".repeat(43))).toBe(true);
    expect(isValidTokenShape("a".repeat(44))).toBe(false);
    expect(isValidTokenShape("invalid+chars+padding=")).toBe(false);
  });
});
