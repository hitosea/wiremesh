/**
 * Subscription format taxonomy.
 *
 * We expose 7 client-named URLs that resolve to 4 underlying generators.
 * Each client gets its own URL so admins can copy a tailored link, even
 * when multiple clients share the same on-the-wire format.
 */

export type ClientId =
  | "generic"
  | "shadowrocket"
  | "v2rayn"
  | "v2rayng"
  | "passwall"
  | "clashverge"
  | "hiddify"
  | "singbox-1.12";

export type FormatKind = "v2ray" | "shadowrocket" | "clash" | "singbox";

export const CLIENT_TO_FORMAT: Record<ClientId, FormatKind> = {
  generic: "v2ray",
  shadowrocket: "shadowrocket",
  v2rayn: "v2ray",
  v2rayng: "v2ray",
  passwall: "v2ray",
  clashverge: "clash",
  hiddify: "singbox",
  "singbox-1.12": "singbox",
};

// Path aliases admins may type. Order matters only for documentation.
export const ALL_CLIENT_IDS: ClientId[] = [
  "generic",
  "clashverge",
  "shadowrocket",
  "hiddify",
  "singbox-1.12",
  "v2rayn",
  "v2rayng",
  "passwall",
];

/**
 * next-intl uses dots as path separators in lookup keys, so a client ID
 * like "singbox-1.12" can't be used directly. Sanitise it for i18n only;
 * the URL slug stays as-is.
 */
export function clientI18nKey(id: ClientId): string {
  return id.replace(/\./g, "_");
}

// Canonical format names also accepted on the URL path.
const CANONICAL_FORMATS: Record<string, FormatKind> = {
  clash: "clash",
  shadowrocket: "shadowrocket",
  v2ray: "v2ray",
  singbox: "singbox",
};

export function resolveFormat(slug: string): FormatKind | null {
  const lower = slug.toLowerCase();
  if (lower in CLIENT_TO_FORMAT) return CLIENT_TO_FORMAT[lower as ClientId];
  if (lower in CANONICAL_FORMATS) return CANONICAL_FORMATS[lower];
  return null;
}

/**
 * Which protocols each canonical format can carry. UI shows this so admins
 * see at a glance whether a given client URL will silently drop devices.
 */
export const FORMAT_PROTOCOL_SUPPORT: Record<FormatKind, { wireguard: boolean; xray: boolean; socks5: boolean }> = {
  clash: { wireguard: true, xray: true, socks5: true },
  shadowrocket: { wireguard: true, xray: true, socks5: true },
  // V2Ray family now ships wg:// for WG devices. Modern V2RayN/NG/NekoBox
  // builds parse it; older or strict V2Ray builds silently ignore — either
  // way the vless/socks5 entries still work, so we count this as supported.
  v2ray: { wireguard: true, xray: true, socks5: true },
  singbox: { wireguard: true, xray: true, socks5: true },
};
