# Subscription URL (Roadmap #2) — Design Spec

**Status**: Locked-in design, ready to implement.
**Date**: 2026-04-26
**Scope**: v1 of feature #2 from the post-1.2.2 roadmap. Decisions made autonomously (user delegated final calls).

## Problem

Today, every change to a device, line, or entry node config (port / exit node / line topology) invalidates every client's `.conf` or share-link. Admin must regenerate and manually redistribute config to each client.

## Goal

Give each "subscription group" of devices one stable URL. Clients (Clash family, Shadowrocket) auto-poll the URL and pick up the latest config.

## Out of scope (deferred)

- Client-side rule editor (server-side filter is the routing brain — client just gets a minimal `MATCH,Select`)
- Subscription expiry / per-user quota
- Quantumult X compatibility (no native WG)
- Multi-region failover groups (Clash's own `fallback` group is admin-configurable in template)

---

## Architecture

### Data model — two new tables

```ts
// subscription_groups
{ id, name, token (unique), remark, createdAt, updatedAt }

// subscription_group_devices  (M:N join)
{ groupId (FK→subscription_groups, ON DELETE CASCADE),
  deviceId (FK→devices, ON DELETE CASCADE),
  createdAt }
// PK: (groupId, deviceId)
```

- A device can belong to multiple groups (e.g. "all my devices" + "shared with friend A subset").
- Deleting a device cascades from all groups (no surprises).
- Deleting a group only clears the join table; devices remain.

### Token

- 32 random bytes → base64url (43 chars, no padding).
- Stored plaintext (single-admin internal use; defense-in-depth hashing can be added later — not v1).
- Path form `/api/sub/<token>/<format>`, **never** in query string (avoids server log / browser history leak).
- Long-lived. Admin manually rotates (replaces token, old URL → 410 Gone) or deletes the group.
- Format ∈ `{clash, shadowrocket}`.

### Auth bypass

`/api/sub/` added to `PUBLIC_PATHS` in `src/proxy.ts`. The route itself is gated by token lookup — no JWT required. Invalid token → 404. (Don't leak existence by returning 410 indistinguishably; only rotate yields 410 inside the same code path? — actually easiest: any unrecognized token → 404. Rotation simply changes the token, so the old one is just "unrecognized". 410 isn't actually distinguishable from 404 from the server's POV — drop it from the design, just use 404.)

### Output format strategy

#### Clash YAML (Mihomo / Clash Verge Rev / Stash / FlClash)

- Repo-bundled template `src/lib/subscription/templates/clash-default.yaml`:
  - Top-level: `mode: rule`, `dns: { enable, listen: 0.0.0.0:1053, nameserver: [114.114.114.114, 8.8.8.8] }`, `port: 7890`, `socks-port: 7891`
  - `proxy-groups`: one `Select` group whose `proxies` field is the placeholder `__ALL_PROXIES__` (replaced at build time with full list of device names + `DIRECT`)
  - `rules`: minimal — `DOMAIN-SUFFIX,cn,DIRECT`, `GEOIP,CN,DIRECT`, `MATCH,Select`
- At render time, code:
  1. Loads and parses template
  2. Builds one proxy entry per device in the group (per-protocol builder)
  3. Replaces placeholder in proxy-groups with all proxy names + `DIRECT`
  4. Prepends `DOMAIN,<sub-host>,DIRECT` to rules (anti-loop on subscription host itself)
  5. Stringifies to YAML

#### Per-protocol Clash proxy entries

| Protocol | Output |
|---|---|
| WireGuard | `{type: wireguard, server: <entry-pub-ip>, port: <entry-wg-port>, ip: <device-wg-addr-ip>, private-key, public-key: <entry-wg-pub>, allowed-ips: [0.0.0.0/0, ::/0], dns: <entry-wg-ip>, mtu: 1420}` |
| Xray (Reality) | `{type: vless, server, port: <line.xrayPort>, uuid, network: tcp, tls: true, flow: xtls-rprx-vision, reality-opts: {public-key, short-id}, servername: <reality-sni>, client-fingerprint: chrome}` |
| Xray (ws-tls) | `{type: vless, server, port, uuid, tls: true, network: ws, ws-opts: {path, headers: {Host}}, servername: <tls-domain>}` |
| SOCKS5 | `{type: socks5, server, port: <line.socks5Port>, username, password}` |

#### Shadowrocket

base64(newline-joined URIs). One URI per device. Empty header line not needed.

| Protocol | URI scheme |
|---|---|
| WireGuard | `wireguard://<base64-of-conf-body>#<name>` (SR's documented format) |
| Xray | `vless://uuid@host:port?params#name` (reuse existing builder) |
| SOCKS5 | `socks5://username:password@host:port#name` (RFC-style, SR-compatible) |

### File layout

```
src/lib/subscription/
  types.ts                       — DeviceContext, NodeContext, output types
  load-device-context.ts         — DB → fully resolved context (decrypts keys)
  clash-builder.ts               — one function per protocol → proxy object
  shadowrocket-builder.ts        — one function per protocol → URI string
  render.ts                      — top-level: groupId → YAML / base64
  templates/
    clash-default.yaml           — bundled template

src/app/api/sub/[token]/[fmt]/route.ts          — public endpoint
src/app/api/subscriptions/route.ts              — list / create
src/app/api/subscriptions/[id]/route.ts         — get / put / delete
src/app/api/subscriptions/[id]/devices/route.ts — replace devices list
src/app/api/subscriptions/[id]/rotate-token/route.ts — rotate

src/app/(dashboard)/subscriptions/
  page.tsx                       — list
  new/page.tsx                   — create form
  [id]/page.tsx                  — detail / edit / device picker / URLs

__tests__/lib/subscription/
  clash-builder.test.ts
  shadowrocket-builder.test.ts
  render.test.ts                 — integration with in-memory DB
```

### Public endpoint response

- `GET /api/sub/<token>/clash`
  - `200 text/yaml; charset=utf-8`
  - `Content-Disposition: inline; filename="wiremesh-<sanitized-name>.yaml"`
  - `profile-update-interval: 24` (hours; Clash convention)
- `GET /api/sub/<token>/shadowrocket`
  - `200 text/plain; charset=utf-8` (body = base64)
- Invalid token → `404`

### i18n

New namespace `subscriptions` in `messages/zh-CN.json` and `messages/en.json`.

### Sidebar

Add new nav item `subscriptions` to `nav.config` group, between `filters` and `settings`. Icon: `Rss` from lucide.

---

## Open scope kept out of v1

- **DB token hashing** — plaintext is fine for single-admin; can hash later if multi-tenant becomes a thing.
- **ETag / 304 Not Modified** — clients re-poll cheaply enough that this is premature optimization.
- **Per-protocol Shadowrocket WG real testing** — SR's wireguard:// scheme works in newer SR versions; admin can fall back to manual `.conf` import via Files app if a particular SR build doesn't accept it.
- **Per-group rules / proxy-groups override** — defer to feature #4 (rule subscriptions). When #4 lands, the template can use `rule-providers`.

## Verification

- Unit tests cover each protocol's proxy/URI shape.
- Integration test: build a 3-device subscription (one per protocol) and verify the YAML parses and contains all three proxies named in the Select group.
- Manual smoke: with dev server running, create a group with 1–3 devices and curl `/api/sub/<token>/clash` to inspect output.

## Implementation order

1. DB migration + schema
2. `load-device-context` + crypto/token helpers
3. Clash + Shadowrocket builders (with tests)
4. `render.ts` orchestrator (with test)
5. Public sub endpoint
6. Admin CRUD endpoints
7. Frontend pages
8. i18n + sidebar
9. Type-check + build + tests
