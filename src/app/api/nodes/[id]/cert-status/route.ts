import { X509Certificate } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type CertStatus = "none" | "pending" | "valid" | "warning" | "expired" | "invalid";

function firstPemCertificate(pem: string): string | null {
  const match = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  return match?.[0] ?? null;
}

function toIsoDate(value: string): string {
  return new Date(value).toISOString();
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id, 10);
  if (Number.isNaN(nodeId)) return error("VALIDATION_ERROR", "validation.invalidNodeId");

  const node = db
    .select({
      id: nodes.id,
      xrayTransport: nodes.xrayTransport,
      xrayCertMode: nodes.xrayCertMode,
      xrayTlsDomain: nodes.xrayTlsDomain,
      xrayTlsCert: nodes.xrayTlsCert,
    })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();

  if (!node) return error("NOT_FOUND", "notFound.node");

  const mode = node.xrayCertMode ?? "manual";
  const domain = node.xrayTlsDomain ?? "";

  if (node.xrayTransport !== "ws-tls") {
    return success({ mode, domain, status: "none" satisfies CertStatus });
  }

  if (!node.xrayTlsCert) {
    return success({ mode, domain, status: "pending" satisfies CertStatus });
  }

  const pem = firstPemCertificate(node.xrayTlsCert);
  if (!pem) {
    return success({ mode, domain, status: "invalid" satisfies CertStatus });
  }

  try {
    const cert = new X509Certificate(pem);
    const notBefore = toIsoDate(cert.validFrom);
    const notAfter = toIsoDate(cert.validTo);
    const expiresAt = new Date(notAfter).getTime();
    const now = Date.now();
    const daysRemaining = Math.ceil((expiresAt - now) / 86_400_000);
    const status: CertStatus = daysRemaining < 0 ? "expired" : daysRemaining <= 30 ? "warning" : "valid";
    const renewalAt = new Date(expiresAt - 30 * 86_400_000).toISOString();

    return success({
      mode,
      domain,
      status,
      notBefore,
      notAfter,
      daysRemaining,
      issuer: cert.issuer,
      subject: cert.subject,
      serialNumber: cert.serialNumber,
      nextRenewalAt: renewalAt,
    });
  } catch {
    return success({ mode, domain, status: "invalid" satisfies CertStatus });
  }
}
