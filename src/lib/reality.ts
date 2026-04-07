import { generateKeyPairSync, randomBytes } from "crypto";

export function generateRealityKeypair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("x25519", {});
  const privRaw = privateKey
    .export({ type: "pkcs8", format: "der" })
    .subarray(-32);
  const pubRaw = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  return {
    privateKey: Buffer.from(privRaw).toString("base64url"),
    publicKey: Buffer.from(pubRaw).toString("base64url"),
  };
}

export function generateShortId(): string {
  return randomBytes(8).toString("hex");
}
