import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

describe("crypto", () => {
  it("encrypt/decrypt roundtrip", () => {
    const plaintext = "hello world";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("encrypts empty string", () => {
    const ciphertext = encrypt("");
    expect(decrypt(ciphertext)).toBe("");
  });

  it("encrypts unicode text", () => {
    const plaintext = "WireGuard 节点密钥";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const plaintext = "same input";
    const ct1 = encrypt(plaintext);
    const ct2 = encrypt(plaintext);
    expect(ct1).not.toBe(ct2);
  });

  it("throws on tampered ciphertext", () => {
    const ciphertext = encrypt("sensitive data");
    const buf = Buffer.from(ciphertext, "base64");
    // Flip a byte in the encrypted payload area
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when ENCRYPTION_KEY is missing", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
  });

  it("throws when ENCRYPTION_KEY is wrong length", () => {
    process.env.ENCRYPTION_KEY = "tooshort";
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
  });
});
