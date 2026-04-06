import { describe, it, expect } from "vitest";
import { generateKeyPair } from "@/lib/wireguard";

describe("wireguard", () => {
  it("generates keys that are 44 characters (base64 of 32 bytes)", () => {
    const { privateKey, publicKey } = generateKeyPair();
    expect(privateKey).toHaveLength(44);
    expect(publicKey).toHaveLength(44);
  });

  it("keys are valid base64", () => {
    const { privateKey, publicKey } = generateKeyPair();
    expect(() => Buffer.from(privateKey, "base64")).not.toThrow();
    expect(() => Buffer.from(publicKey, "base64")).not.toThrow();
    expect(Buffer.from(privateKey, "base64")).toHaveLength(32);
    expect(Buffer.from(publicKey, "base64")).toHaveLength(32);
  });

  it("each call produces a unique key pair", () => {
    const pair1 = generateKeyPair();
    const pair2 = generateKeyPair();
    expect(pair1.privateKey).not.toBe(pair2.privateKey);
    expect(pair1.publicKey).not.toBe(pair2.publicKey);
  });

  it("private key and public key are different", () => {
    const { privateKey, publicKey } = generateKeyPair();
    expect(privateKey).not.toBe(publicKey);
  });
});
