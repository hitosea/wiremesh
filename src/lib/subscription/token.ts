import { randomBytes } from "crypto";

export function generateSubscriptionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidTokenShape(token: string): boolean {
  // 32 random bytes encoded as base64url with no padding = 43 chars, [A-Za-z0-9_-]
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
