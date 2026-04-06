import { generateKeyPairSync } from "crypto";

export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519", {});
  const privRaw = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
  const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return {
    privateKey: privRaw.toString("base64"),
    publicKey: pubRaw.toString("base64"),
  };
}
