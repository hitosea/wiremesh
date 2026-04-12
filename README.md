# WireMesh

[中文](README.zh-CN.md)

WireGuard mesh network management platform for managing VPN nodes, client devices, network lines, and tunnel configurations.

## Features

- **Node Management** — Add VPN nodes with one-click install scripts. Supports Ubuntu/Debian/CentOS/RHEL/Rocky/AlmaLinux/Fedora, x86_64 and ARM64.
- **Device Management** — Three protocols: WireGuard, Xray (VLESS Reality), and SOCKS5. Auto-generates client configurations.
- **Line Orchestration** — Multi-hop routing (entry → relay → exit) with automatic tunnel key and config generation.
- **Dashboard** — Node/device/line status overview, traffic stats, online monitoring.
- **System Settings** — Customizable subnets, ports, DNS, and audit logging.

## Architecture

```
┌────────────────────────────────┐
│     Docker Container           │
│                                │
│  Next.js (Web+API+SSE)        │
│  Worker (scheduled tasks)      │
│  SQLite                        │
└───────────────┬────────────────┘
                │ SSE + HTTP
        ┌───────┴───────┐
        ▼               ▼
   Node Agent      Node Agent
   (Go binary)    (Go binary)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js (App Router) |
| Frontend | React 19 + TypeScript + shadcn/ui + Tailwind CSS |
| Database | SQLite (Drizzle ORM) |
| Node Agent | Go single binary |
| VPN Protocols | WireGuard + Xray (VLESS Reality) + SOCKS5 |
| Deployment | Docker Compose |

## Quick Start

### 1. Deploy the Management Platform

**Using pre-built image (recommended):**

```bash
# Download docker-compose.yml and set PUBLIC_URL
docker compose up -d
```

Image: `ghcr.io/hitosea/wiremesh:latest`, supports amd64 and arm64.

**Build from source:**

```bash
git clone <repo-url> wiremesh
cd wiremesh
cp .env.example .env
# Edit .env, set PUBLIC_URL
docker compose up -d --build
```

Visit `http://your-server-ip:3456`. The setup page will appear on first launch.

### 2. Add Nodes

Add a node in the management platform, then copy the one-click install command from the node detail page and run it as root on the target server.

### 3. Create Lines

Select an entry node and exit node (optionally add relay nodes). The system auto-generates tunnel keys and configurations.

### 4. Add Devices

Create a device, choose a protocol (WireGuard, Xray, or SOCKS5), assign it to a line, and download the client config.

## Node Requirements

- Linux (Ubuntu 20+, Debian 11+, CentOS 8+, RHEL, Rocky, AlmaLinux, Fedora)
- x86_64 or ARM64, kernel 5.6+
- Public IP
- Firewall: UDP 41820 (device access), UDP 41830+ (inter-node tunnels), TCP 41443+ (Xray / SOCKS5 access)

## Development

```bash
npm install
npm run dev -- --port 3000 --hostname 0.0.0.0

# Tests
npm run test
cd agent && go test ./...
```

For architecture details, API reference, and Agent protocol, see [docs/requirements.md](docs/requirements.md).

## Release

Push to `main` to auto-build and publish the Docker image to GHCR:

```bash
docker compose pull && docker compose up -d
```

## Environment Variables

| Variable | Description | Default |
|----------|------------|---------|
| `PUBLIC_URL` | Public URL of the management platform (used in install scripts) | `http://localhost:3456` |
| `JWT_SECRET` | JWT signing key (at least 32 characters) | Built-in |
| `ENCRYPTION_KEY` | AES-256-GCM key (64-character hex string) | Built-in |

## License

MIT
