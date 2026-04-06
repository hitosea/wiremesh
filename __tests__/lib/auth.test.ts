import { describe, it, expect, beforeEach } from "vitest";
import { hashPassword, verifyPassword, signToken, verifyToken } from "@/lib/auth";

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret-key-for-testing-purposes-only";
});

describe("auth", () => {
  describe("password hashing", () => {
    it("hashes and verifies password correctly", async () => {
      const password = "mySecurePassword123!";
      const hash = await hashPassword(password);
      expect(hash).not.toBe(password);
      expect(hash.startsWith("$2")).toBe(true);
      await expect(verifyPassword(password, hash)).resolves.toBe(true);
    });

    it("returns false for wrong password", async () => {
      const hash = await hashPassword("correctPassword");
      await expect(verifyPassword("wrongPassword", hash)).resolves.toBe(false);
    });

    it("generates different hashes for same password (salted)", async () => {
      const hash1 = await hashPassword("samePassword");
      const hash2 = await hashPassword("samePassword");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("JWT sign/verify", () => {
    it("signs and verifies a token roundtrip", async () => {
      const payload = { sub: "1", username: "admin" };
      const token = await signToken(payload);
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);

      const verified = await verifyToken(token);
      expect(verified.sub).toBe("1");
      expect(verified.username).toBe("admin");
    });

    it("throws for invalid token", async () => {
      await expect(verifyToken("invalid.token.here")).rejects.toThrow();
    });

    it("throws for token with wrong secret", async () => {
      const payload = { sub: "1", username: "admin" };
      const token = await signToken(payload);

      process.env.JWT_SECRET = "different-secret-key-that-wont-match";
      await expect(verifyToken(token)).rejects.toThrow();
    });

    it("throws when JWT_SECRET is missing", async () => {
      delete process.env.JWT_SECRET;
      await expect(signToken({ sub: "1", username: "admin" })).rejects.toThrow("JWT_SECRET");
    });
  });
});
