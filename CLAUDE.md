# WireMesh

WireGuard mesh VPN management platform. Single admin, internal use. Manages nodes (servers), devices (clients), lines (multi-hop routes), and filter rules (traffic routing).

## Architecture Constraints

These are confirmed decisions — do not deviate:

1. **Nodes have no fixed role** — No role field on nodes table. Roles are determined entirely by line orchestration (line_nodes). A single node can simultaneously be entry on one line, relay on another, exit on a third.
2. **SSE + HTTP (not WebSocket)** — Platform pushes notifications to Agent via SSE. Agent pulls config via HTTP GET, reports status via HTTP POST. No WebSocket anywhere.
3. **Xray is entry-layer only** — Xray decrypts VLESS Reality traffic and injects it into wm-wg0. All inter-node tunnels use WireGuard. Xray is never used between nodes.
4. **SOCKS5 is entry-layer only** — Per-line SOCKS5 proxy servers on entry nodes. Traffic routed via SO_MARK fwmark into WireGuard tunnels, same as Xray.
5. **Tunnel keys in line_tunnels** — Each tunnel's keys/addresses/ports are stored in line_tunnels (not line_nodes). Relay nodes appear in two rows.
6. **WireGuard interface isolation** — Config dir: `/etc/wiremesh/wireguard/`. Interface prefix: `wm-` (wm-wg0 for device access, wm-tun1/2/3 for tunnels). Never use system `/etc/wireguard/`.
7. **IP/port allocation** — Device subnet 10.210.0.0/24 (nodes from .1, devices from .100). Tunnel subnet 10.211.0.0/16 (/30 per tunnel). WG port 41820, tunnel ports from 41830, Xray/SOCKS5 ports from 41443. These avoid conflicts with Docker/K8s/cloud VPCs.

## Naming Conventions

| Item | Name |
|------|------|
| Agent binary | wiremesh-agent |
| Agent service | wiremesh-agent.service |
| Config directory | /etc/wiremesh/ |
| Device access interface | wm-wg0 |
| Tunnel interfaces | wm-tun1, wm-tun2, ... |
| iptables tags | wm-line-{id} |
| Xray binary | wiremesh-xray |
| Xray service | wiremesh-xray.service |
| Database file | wiremesh.db |

## Development Rules

- **i18n**: Use next-intl (route-free mode). Translation files in `messages/` (zh-CN.json, en.json). All UI text must use `useTranslations()` hook — never hardcode Chinese or English strings.
- **API errors**: Use translation keys (e.g. `"validation.nameRequired"`), frontend translates.
- **Encryption**: All private keys and SOCKS5 passwords must be AES-256-GCM encrypted via `src/lib/crypto.ts` before storage.
- **Pagination**: All list APIs use server-side pagination.
- **Responsive**: Desktop and tablet only, no mobile optimization needed.
- **Docs**: Full API design, DB schema, and Agent protocol in `docs/requirements.md`.
