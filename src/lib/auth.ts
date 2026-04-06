import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const SALT_ROUNDS = 10;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: { sub: string; username: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .setIssuer("wiremesh")
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<{ sub: string; username: string }> {
  const { payload } = await jwtVerify(token, getJwtSecret(), { issuer: "wiremesh" });
  return payload as { sub: string; username: string };
}
