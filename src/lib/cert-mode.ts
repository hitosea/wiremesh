// Single source of truth for a node's TLS certificate management mode.
//
// - "auto":   the agent obtains/renews the cert itself via built-in ACME
// - "certd":  an external certd service pushes/renews the cert via webhook
// - "manual": an admin uploads the cert; nobody renews it automatically
//
// Cert mode only has meaning for ws-tls transport; reality/tcp nodes are
// always "manual" (the field is dormant). The agent acts on "auto" only.
export const CERT_MODES = ["auto", "certd", "manual"] as const;

export type CertMode = (typeof CERT_MODES)[number];

export function isCertMode(value: unknown): value is CertMode {
  return typeof value === "string" && (CERT_MODES as readonly string[]).includes(value);
}
