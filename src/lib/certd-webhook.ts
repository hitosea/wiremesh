import { NextRequest } from "next/server";
import { timingSafeEqual, X509Certificate, createPrivateKey } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { sseManager } from "@/lib/sse-manager";

export type AuthFailure =
  | { ok: false; code: "CERTD_WEBHOOK_DISABLED"; message: string }
  | { ok: false; code: "UNAUTHORIZED"; message: string };

export type AuthResult = { ok: true } | AuthFailure;

export function authenticate(req: NextRequest): AuthResult {
  const expected = process.env.CERTD_WEBHOOK_SECRET;
  if (!expected || expected.length === 0) {
    return {
      ok: false,
      code: "CERTD_WEBHOOK_DISABLED",
      message: "CERTD_WEBHOOK_SECRET is not configured",
    };
  }
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Invalid bearer token" };
  }
  const provided = Buffer.from(header.slice(prefix.length));
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Invalid bearer token" };
  }
  return { ok: true };
}

export type CertdPayload = { domain: string; crt: string; key: string };

export type ParseResult =
  | { ok: true; data: CertdPayload[] }
  | { ok: false; reason: string };

function parseEntry(body: unknown, prefix: string): { ok: true; data: CertdPayload } | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: `${prefix}must be a JSON object` };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.domain !== "string" || b.domain.trim() === "") {
    return { ok: false, reason: `${prefix}domain is required` };
  }
  if (typeof b.crt !== "string" || !b.crt.includes("-----BEGIN CERTIFICATE-----")) {
    return { ok: false, reason: `${prefix}crt must be a PEM certificate` };
  }
  if (typeof b.key !== "string" || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(b.key)) {
    return { ok: false, reason: `${prefix}key must be a PEM private key` };
  }
  try {
    new X509Certificate(b.crt);
  } catch {
    return { ok: false, reason: `${prefix}crt failed PEM parsing` };
  }
  try {
    createPrivateKey(b.key);
  } catch {
    return { ok: false, reason: `${prefix}key failed PEM parsing` };
  }
  return { ok: true, data: { domain: b.domain.trim(), crt: b.crt, key: b.key } };
}

// Accepts either a single object `{domain, crt, key}` or an array of such
// objects. The array form lets one push deploy a cert/key across several
// domains (e.g. a SAN cert, or batched per-domain deployments).
export function parsePayload(body: unknown): ParseResult {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { ok: false, reason: "array body must not be empty" };
    }
    const data: CertdPayload[] = [];
    for (let i = 0; i < body.length; i++) {
      const r = parseEntry(body[i], `entry[${i}]: `);
      if (!r.ok) return r;
      data.push(r.data);
    }
    return { ok: true, data };
  }
  const r = parseEntry(body, "");
  if (!r.ok) return r;
  return { ok: true, data: [r.data] };
}

export type ApplyResult = { matched: number; updated: number };

export function applyCertToMatchingNodes(payload: CertdPayload): ApplyResult {
  const matching = db
    .select({ id: nodes.id, xrayTlsCert: nodes.xrayTlsCert })
    .from(nodes)
    .where(and(eq(nodes.xrayTransport, "ws-tls"), eq(nodes.xrayTlsDomain, payload.domain)))
    .all();

  const toUpdate = matching.filter((row) => row.xrayTlsCert !== payload.crt);

  if (toUpdate.length > 0) {
    const encryptedKey = encrypt(payload.key);
    db.transaction((tx) => {
      for (const row of toUpdate) {
        tx.update(nodes)
          .set({
            xrayTlsCert: payload.crt,
            xrayTlsKey: encryptedKey,
            xrayCertMode: "certd",
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(nodes.id, row.id))
          .run();
      }
    });
    for (const row of toUpdate) {
      sseManager.notifyNodeConfigUpdate(row.id);
    }
  }

  return { matched: matching.length, updated: toUpdate.length };
}

export type DomainResult = { domain: string } & ApplyResult;
export type ApplyManyResult = {
  results: DomainResult[];
  matched: number;
  updated: number;
};

// Applies a list of cert payloads. Duplicate domains are collapsed (last one
// wins) so the same node is never written twice in a single push.
export function applyCerts(payloads: CertdPayload[]): ApplyManyResult {
  const byDomain = new Map<string, CertdPayload>();
  for (const p of payloads) byDomain.set(p.domain, p);

  const results: DomainResult[] = [];
  for (const p of byDomain.values()) {
    const r = applyCertToMatchingNodes(p);
    results.push({ domain: p.domain, matched: r.matched, updated: r.updated });
  }
  return {
    results,
    matched: results.reduce((sum, r) => sum + r.matched, 0),
    updated: results.reduce((sum, r) => sum + r.updated, 0),
  };
}
