# WireMesh Management Platform — Requirements Document

> Version: 3.0
> Date: 2026-04-12

---

## 1. Project Overview

### 1.1 Purpose

An internal WireMesh network management platform for managing VPN nodes (servers), client access points (devices), network lines, and traffic routing rules. The system is used by a single administrator and does not involve multi-tenancy or billing features.

### 1.2 Business Scale

Initial small-to-medium scale: 10–50 nodes, 50–200 devices.

### 1.3 Technology Stack

| Layer | Technology |
|-------|-----------|
| Full-stack Framework | Next.js (App Router) |
| Frontend UI | React 19 + TypeScript + shadcn/ui + Tailwind CSS |
| Database | SQLite (Drizzle ORM) |
| Background Tasks | Lightweight Node.js Worker process (same container as Next.js) |
| Node Agent | Go single binary (deployed to each node server, supports linux/amd64 and linux/arm64) |
| VPN Protocol | WireGuard + Xray (VLESS Reality) + SOCKS5 |
| Sensitive Data Encryption | AES-256-GCM, key injected via `ENCRYPTION_KEY` environment variable |
| Internationalization | next-intl routeless mode (Chinese + English) |
| Deployment | Docker Compose (single container) |

### 1.4 Code Organization

Monorepo structure with Agent and management platform in the same repository:

```
wiremesh/
├── src/                    # Next.js Management Platform
├── agent/                  # Go Agent source code
├── worker/                 # Node.js Worker process
├── docs/                   # Documentation
├── messages/               # i18n translation files (zh-CN.json, en.json)
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### 1.5 Single-Container Architecture

```
┌────────────────────────────────────────┐
│     Docker Container (Management Platform) │
│                                        │
│  Next.js (Web+API+SSE)                │
│  Worker (Scheduled Tasks+Health Checks)│
│  SQLite                                │
└───────────────────┬────────────────────┘
                    │ SSE + HTTP
                    ▼
              Node Agent(s)
              (Go binary)
```

- Next.js handles frontend page rendering, API endpoints, and SSE push notifications
- Worker process handles scheduled tasks (node health checks, data cleanup, etc.)
- SQLite data files are persisted via Docker Volume
- Node Agent runs on each node server, receives notifications via SSE, and reports data via HTTP POST

---

## 2. Users & Authentication

### 2.1 Roles

Only one role: **Administrator**. No multi-user system.

### 2.2 Authentication Method

- Username + password login
- JWT Token session management
- On first startup, redirects to an initialization page to set up administrator credentials
- Supports password changes

### 2.3 First-Time Initialization

On first system startup (no administrator record in database), automatically redirects to the `/setup` page:

- Set administrator username and password
- Other configurations use default values and can be modified later in the settings page
- After initialization, redirects to the login page

---

## 3. Feature Modules

### 3.1 Dashboard

Overview page displaying overall system status:

- Total nodes / online / offline count
- Total devices (access points) / online count
- Total lines / active count
- Basic traffic statistics per node (upload/download)
- Node/device online status list (quick preview)

---

### 3.2 Node Management (Nodes)

Node = cloud server running WireGuard and/or Xray/SOCKS5 services. Any node can serve as entry, relay, or exit in different lines — roles are determined by line orchestration. Each node runs one Agent process.

**Device Access Methods:**

- **WireGuard access**: Devices connect directly to a node's wm-wg0 interface via WireGuard protocol
- **Xray access**: Devices connect to a node's Xray service via VLESS Reality protocol; Xray decrypts and forwards to the local wm-wg0 interface
- **SOCKS5 access**: Devices connect to a node's SOCKS5 server via system proxy (username/password authentication); traffic is routed to tunnels via fwmark

```
WireGuard Device ──WG tunnel──► wm-wg0(entry node) ──► WG tunnel chain ──► exit ──► Internet
Xray Device ──VLESS Reality──► Xray(entry node) ──► wm-wg0 ──► WG tunnel chain ──► exit ──► Internet
SOCKS5 Device ──proxy──► SOCKS5(entry node) ──fwmark──► WG tunnel chain ──► exit ──► Internet
```

**Xray's Role:** Xray serves only as an entry-layer access proxy, solving the "how devices connect" problem (applicable in network environments where WireGuard is blocked). All inter-node tunnel links use WireGuard exclusively — Xray is not involved.

#### 3.2.1 Node Fields

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| name | string | Node name |
| ip | string | Server public IP |
| domain | string? | Optional domain name |
| port | number | WireGuard listen port |
| agent_token | string | Agent authentication token (auto-generated on creation, unique) |
| wg_private_key | string | WireGuard private key (auto-generated, encrypted storage) |
| wg_public_key | string | WireGuard public key (auto-generated) |
| wg_address | string | WireGuard internal address (e.g., 10.210.0.1/24) |
| xray_protocol | string? | VLESS protocol |
| xray_transport | string? | Transport layer (uses tcp + Reality in practice) |
| xray_port | number? | Xray listen port |
| xray_config | json? | Xray extended configuration (includes Reality key pair, dest, shortId, etc.) |
| external_interface | string | External network interface name (default eth0) |
| status | enum | online / offline / installing / error |
| error_message | string? | Error message (when status is error) |
| agent_version | string? | Current Agent version |
| xray_version | string? | Current Xray version |
| upgrade_triggered_at | datetime? | Agent upgrade trigger time |
| xray_upgrade_triggered_at | datetime? | Xray upgrade trigger time |
| pending_delete | boolean | Whether awaiting uninstall/deletion |
| remark | text? | Remark |
| created_at | datetime | Creation time |
| updated_at | datetime | Update time |

#### 3.2.2 Node Features

- **CRUD**: Create, edit, delete nodes
- **One-click install script generation**: Generate bash install scripts based on node configuration, supporting Ubuntu/Debian/CentOS/RHEL/Rocky/AlmaLinux/Fedora, x86_64 and ARM64
- **Remote uninstall**: Notify Agent via SSE to execute uninstall; node is marked as pending_delete; Worker cleans up after 7 days
- **Agent upgrade**: Trigger Agent to automatically download a new version and restart via SSE
- **Xray upgrade**: Trigger Xray binary update via SSE
- **Batch operations**: Batch delete, batch upgrade
- **Status monitoring**: Agent periodically reports online status, latency, and version number
- **Configuration sync**: When node parameters or associated Peers change, notify Agent via SSE to pull and apply the latest configuration

#### 3.2.3 Node Status Records

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| node_id | FK | Associated node |
| is_online | boolean | Whether online |
| latency | number? | Latency (ms) |
| upload_bytes | bigint | Upload traffic |
| download_bytes | bigint | Download traffic |
| checked_at | datetime | Check time |

**Data Retention Policy:** Retained for 7 days; Worker periodically cleans expired records.

---

### 3.3 Device Management (Devices)

Device = client access point, i.e., a terminal (computer, phone, router, etc.) connecting to the VPN network.

#### 3.3.1 Device Fields

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| name | string | Device name |
| protocol | enum | Access protocol: wireguard / xray / socks5 |
| wg_public_key | string? | WireGuard public key (for WG protocol) |
| wg_private_key | string? | WireGuard private key (auto-generated, encrypted storage, for WG protocol) |
| wg_address | string? | Assigned WireGuard internal IP |
| xray_uuid | string? | Xray client UUID (for Xray protocol) |
| xray_config | json? | Xray client configuration parameters |
| socks5_username | string? | SOCKS5 username (for SOCKS5 protocol, auto-generated) |
| socks5_password | string? | SOCKS5 password (for SOCKS5 protocol, auto-generated, encrypted storage) |
| line_id | FK? | Associated line |
| status | enum | online / offline |
| last_handshake | datetime? | Last handshake/connection time |
| upload_bytes | bigint | Cumulative upload traffic |
| download_bytes | bigint | Cumulative download traffic |
| remark | text? | Remark |
| created_at | datetime | Creation time |
| updated_at | datetime | Update time |

#### 3.3.2 Device Features

- **CRUD**: Create, edit, delete devices
- **Auto-generate keys/UUID/credentials**: Automatically generate WireGuard key pair, Xray UUID, or SOCKS5 username/password based on protocol when creating a device
- **Generate client configuration**: WireGuard .conf file, Xray VLESS share link, SOCKS5 proxy address
- **Peer auto-sync**: After creating/deleting/modifying a device, notify relevant node Agents via SSE to update configuration
- **Associate with line**: Bind a device to a specified line
- **Traffic statistics**: Agent reports incremental upload/download traffic per device
- **Online status**: Determined via Agent-reported WireGuard handshake or Xray online user data
- **Batch operations**: Batch delete, batch switch lines

---

### 3.4 Line Management (Lines)

Line = logical tunnel chain, composed of entry and exit nodes, defining the traffic forwarding path.

#### 3.4.1 Line Fields

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| name | string | Line name |
| status | enum | active / inactive |
| remark | text? | Remark |
| created_at | datetime | Creation time |
| updated_at | datetime | Update time |

#### 3.4.2 Line-Node Association (Multi-Hop Support)

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| line_id | FK | Associated line |
| node_id | FK | Associated node |
| branch_id | FK? | Associated branch (NULL indicates main path) |
| hop_order | number | Hop sequence (0=entry, 1=relay, 2=exit...) |
| role | enum | entry / relay / exit |

#### 3.4.3 Line Branches (line_branches)

Lines support multiple branch exits for routing rules to match different destinations via different paths.

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| line_id | FK | Associated line |
| name | string | Branch name |
| is_default | boolean | Whether this is the default branch |
| created_at | datetime | Creation time |
| updated_at | datetime | Update time |

#### 3.4.4 Line Tunnels (line_tunnels)

Each tunnel represents a point-to-point WireGuard link between two adjacent nodes.

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| line_id | FK | Associated line |
| hop_index | number | Tunnel sequence number |
| from_node_id | FK | Node at the lower hop_order end |
| to_node_id | FK | Node at the higher hop_order end |
| from_wg_private_key | string | from-end WireGuard private key (encrypted storage) |
| from_wg_public_key | string | from-end WireGuard public key |
| from_wg_address | string | from-end tunnel internal IP (e.g., 10.211.0.1/30) |
| from_wg_port | number | from-end WireGuard listen port |
| to_wg_private_key | string | to-end WireGuard private key (encrypted storage) |
| to_wg_public_key | string | to-end WireGuard public key |
| to_wg_address | string | to-end tunnel internal IP (e.g., 10.211.0.2/30) |
| to_wg_port | number | to-end WireGuard listen port |
| branch_id | FK? | Associated branch (NULL indicates main path) |

**Node Composition Rules:**

- Nodes have no fixed role; roles are entirely determined by line orchestration
- The same node can participate in multiple lines simultaneously, serving different roles in different lines
- Lines are independent of each other and do not affect one another

**Multi-Hop Forwarding Mechanism:** Each hop establishes an independent WireGuard tunnel interface (wm-tun1, wm-tun2, ...). Relay nodes forward traffic via iptables rules. wm-wg0 is reserved for device access.

#### 3.4.5 Line Features

- **CRUD**: Create, edit, delete lines
- **Node orchestration**: Select entry -> (optional) relay -> exit nodes
- **Branch management**: Create multiple branch paths for a line, bind different routing rules
- **Line status**: Automatically determined based on constituent nodes' online status (synced periodically by Worker)
- **Configuration linkage**: Notify all related node Agents to update tunnel configuration when a line changes

---

### 3.5 Routing Rules (Filters)

Routing rules = IP/CIDR and domain-based routing policies that determine which destination traffic goes through the VPN line and which goes direct.

#### 3.5.1 Routing Rule Fields

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| name | string | Rule name |
| rules | text | IP/CIDR rules, one per line |
| domain_rules | text? | Domain rules, one per line |
| mode | enum | whitelist (matched traffic goes through proxy) / blacklist (matched traffic goes direct) |
| is_enabled | boolean | Whether enabled |
| source_url | string? | External rule source URL (periodically synced) |
| source_updated_at | datetime? | Last sync time for rule source |
| remark | text? | Remark |
| created_at | datetime | Creation time |
| updated_at | datetime | Update time |

#### 3.5.2 Routing Rule-Branch Association (branch_filters)

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| branch_id | FK | Associated line branch |
| filter_id | FK | Associated routing rule |

#### 3.5.3 Routing Rule Features

- **CRUD**: Create, edit, delete rules
- **Rule editor**: Supports IP/CIDR rules and domain rules
- **Mode toggle**: Whitelist / blacklist mode
- **External rule source**: Supports periodic sync from URL
- **Associate with branch**: Bind rules to line branches
- **Enable/disable**: Quick toggle for rules

---

### 3.6 System Settings (Settings)

System settings are stored in the settings table as key-value pairs.

#### 3.6.1 Default Configuration Items

| key | Default Value | Description |
|-----|---------------|-------------|
| `wg_default_port` | `41820` | WireGuard default listen port |
| `wg_default_subnet` | `10.210.0.0/24` | WireGuard default internal subnet |
| `wg_default_dns` | `1.1.1.1` | WireGuard client default DNS |
| `wg_node_ip_start` | `1` | Node IP auto-assignment start position (e.g., 10.210.0.1) |
| `wg_device_ip_start` | `100` | Device IP auto-assignment start position (e.g., 10.210.0.100) |
| `xray_default_protocol` | `vless` | Xray default protocol |
| `xray_default_port` | `41443` | Xray / SOCKS5 default starting port |
| `tunnel_subnet` | `10.211.0.0/16` | Tunnel IP address pool subnet |
| `tunnel_port_start` | `41830` | Tunnel WireGuard port auto-assignment start value |
| `node_check_interval` | `5` | Node health check interval (minutes) |
| `filter_sync_interval` | `3600` | External rule source sync interval (seconds, minimum 60) |
| `dns_upstream` | — | Upstream DNS servers (comma-separated) |

The 10.210/10.211 subnets and 41xxx ports are chosen to avoid conflicts with common software such as Docker, Kubernetes, cloud provider VPCs, etc.

---

### 3.7 Audit Log

| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment PK | — |
| action | string | Operation type (create / update / delete) |
| target_type | string | Target object type (node / device / line / filter / settings) |
| target_id | number? | Target object ID |
| target_name | string? | Target object name |
| detail | text? | Operation details |
| created_at | datetime | Operation time |

---

## 4. Node Agent

### 4.1 Technical Approach

| Item | Approach |
|------|----------|
| Language | Go |
| Artifact | Single binary file, supports linux/amd64 and linux/arm64 |
| Deployment | Downloaded as tar.gz from management platform via install script, extracted and registered as a systemd service |
| Communication | SSE for receiving server notifications + HTTP GET/POST for pulling config and reporting data |
| Authentication | Node-level token (auto-generated on node creation, written to Agent config) |

### 4.2 Agent Configuration File

`/etc/wiremesh/agent.yaml`:

```yaml
server_url: "https://management-platform-address"
node_id: 1
token: "node-level-auth-token"
report_interval: 30   # Status report interval (seconds)
```

### 4.3 Agent Startup Flow

```
Agent startup
  ├── Report installation complete (POST /api/agent/installed)
  ├── Pull config (GET /api/agent/config) → Apply config
  ├── Connect SSE (GET /api/agent/sse) → Receive events
  └── Start periodic reporting (every report_interval seconds)
```

### 4.4 Configuration Application Order

Each time the Agent pulls a new configuration, it applies changes in the following order:

1. Sync wm-wg0 Peer list (wg syncconf hot reload)
2. Sync tunnel WireGuard interfaces (create/update/destroy wm-tun*)
3. Sync iptables forwarding rules
4. Sync per-device policy routing
5. Sync Xray configuration (Reality inbound + fwmark routing)
6. Sync SOCKS5 server (per-line start/stop + fwmark routing)
7. Sync branch routing (DNS + ipset rules)

### 4.5 SSE Event Types

| Event | Description |
|-------|-------------|
| `connected` | SSE connection established; Agent force-pulls latest config |
| `peer_update` | Peer list changed (device added/removed/modified, device switched lines) |
| `config_update` | Node's own config changed (parameter modification, routing rule sync, etc.) |
| `tunnel_update` | Line tunnel config changed (multi-hop orchestration changes) |
| `upgrade` | Trigger Agent auto-upgrade |
| `xray_upgrade` | Trigger Xray binary upgrade |
| `node_delete` | Node deleted; Agent executes uninstall |

### 4.6 Agent Shutdown Flow

On shutdown, the Agent cleans up in reverse order: stop SSE, stop Xray, stop SOCKS5, destroy all tunnel interfaces, clean up routes and iptables rules.

---

## 5. API Design

### 5.1 Authentication

```
POST   /api/auth/login          # Login, returns JWT
POST   /api/auth/logout         # Logout
GET    /api/auth/me             # Get current user info
PUT    /api/auth/password       # Change password
```

### 5.2 Initialization

```
GET    /api/setup/status        # Check if already initialized
POST   /api/setup               # Execute initialization (set admin account, default config)
```

### 5.3 Nodes

```
GET    /api/nodes               # Node list (paginated, filtered, searchable)
POST   /api/nodes               # Create node
GET    /api/nodes/:id           # Node details
PUT    /api/nodes/:id           # Update node
DELETE /api/nodes/:id           # Delete node (mark pending_delete, SSE notify uninstall)
POST   /api/nodes/batch         # Batch delete
POST   /api/nodes/batch-upgrade # Batch upgrade
GET    /api/nodes/:id/script    # Get install script
GET    /api/nodes/:id/uninstall-script  # Get uninstall script
GET    /api/nodes/:id/status    # Get node status history
POST   /api/nodes/:id/check     # Manually trigger health check
POST   /api/nodes/:id/upgrade   # Trigger Agent upgrade
POST   /api/nodes/:id/xray-upgrade  # Trigger Xray upgrade
```

### 5.4 Devices

```
GET    /api/devices              # Device list (paginated, filtered, searchable)
POST   /api/devices              # Create device
GET    /api/devices/:id          # Device details
PUT    /api/devices/:id          # Update device
DELETE /api/devices/:id          # Delete device
POST   /api/devices/batch        # Batch delete
GET    /api/devices/:id/config   # Get client configuration
PUT    /api/devices/:id/line     # Switch associated line
```

### 5.5 Lines

```
GET    /api/lines                # Line list (paginated, filtered, searchable)
POST   /api/lines                # Create line
GET    /api/lines/:id            # Line details (includes node orchestration and branches)
PUT    /api/lines/:id            # Update line
DELETE /api/lines/:id            # Delete line
GET    /api/lines/:id/devices    # View associated devices
```

### 5.6 Routing Rules

```
GET    /api/filters              # Rule list (paginated, filtered, searchable)
POST   /api/filters              # Create rule
GET    /api/filters/:id          # Rule details
PUT    /api/filters/:id          # Update rule
DELETE /api/filters/:id          # Delete rule
PUT    /api/filters/:id/toggle   # Enable/disable
POST   /api/filters/:id/sync    # Manually sync external rule source
```

### 5.7 System

```
GET    /api/settings             # Get system settings
PUT    /api/settings             # Update system settings
GET    /api/dashboard            # Dashboard statistics
GET    /api/audit-logs           # Audit log list (paginated, filtered)
```

### 5.8 Agent API (Token Authentication)

```
GET    /api/agent/sse            # SSE long connection, pushes config change notifications
GET    /api/agent/config         # Get full node configuration
POST   /api/agent/status         # Report node status
POST   /api/agent/error          # Report error information
POST   /api/agent/installed      # Report installation complete
GET    /api/agent/binary         # Download Agent binary (tar.gz, supports ?arch=amd64|arm64)
GET    /api/agent/xray           # Download Xray binary (tar.gz, supports ?arch=amd64|arm64)
```

### 5.9 Admin SSE

```
GET    /api/admin/sse            # Admin dashboard real-time push (node status, device status changes)
```

### 5.10 Unified API Response Format

**Success response:**

```json
{ "data": { ... } }
```

**List response:**

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

**Error response:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "validation.nameRequired"
  }
}
```

Error messages use translation keys; the frontend is responsible for translating and displaying them.

**HTTP Status Codes / Error Codes:**

| Status Code | Error Code | Description |
|-------------|------------|-------------|
| 400 | VALIDATION_ERROR | Request parameter validation failed |
| 401 | UNAUTHORIZED | Not logged in or token expired |
| 403 | FORBIDDEN | No permission to access |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource conflict (duplicate IP/name, etc.) |
| 500 | INTERNAL_ERROR | Internal server error |
| 502 | CONFIG_SYNC_FAILED | Configuration sync failed |
| 503 | NODE_OFFLINE | Node is offline |

### 5.11 Pagination Conventions

All list APIs support unified pagination parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| page | Page number | 1 |
| pageSize | Items per page | 20 |
| search | Search keyword | — |
| status | Status filter | — |
| sortBy | Sort field | created_at |
| sortOrder | Sort direction asc/desc | desc |

---

## 6. Database Design

### 6.1 ER Diagram

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│  nodes   │◄──────│ line_nodes   │──────►│  lines   │
│          │  1:N  │              │  N:1  │          │
└──────────┘       └──────────────┘       └────┬─────┘
     │                                         │
     │ 1:N                                1:N  │
     ▼                                         ▼
┌──────────────┐                     ┌──────────────┐
│ node_status  │                     │   devices    │
└──────────────┘                     └──────────────┘

┌──────────┐       ┌──────────────┐       ┌──────────────┐
│  lines   │──────►│ line_branches│──────►│branch_filters│
│          │  1:N  │              │  1:N  │              │
└──────────┘       └──────────────┘       └──────┬───────┘
                                                 │ N:1
┌──────────┐       ┌──────────────┐              │
│  lines   │──────►│ line_tunnels │       ┌──────┴───────┐
│          │  1:N  │              │       │   filters    │
└──────────┘       └──────────────┘       └──────────────┘

┌──────────┐       ┌──────────────┐
│  users   │       │  settings    │
└──────────┘       └──────────────┘

┌──────────────┐
│ audit_logs   │
└──────────────┘
```

### 6.2 Table List

| Table | Description |
|-------|-------------|
| users | Administrator account |
| nodes | VPN nodes |
| node_status | Node status monitoring records (retained 7 days) |
| lines | Network lines |
| line_nodes | Line-node association (includes hop order and role) |
| line_branches | Line branches (multiple exit paths) |
| line_tunnels | Line tunnels (key pair, address, and port for each tunnel endpoint) |
| devices | Client access points |
| filters | Routing rules (IP/CIDR + domain) |
| branch_filters | Branch-routing rule association |
| settings | System settings (key-value) |
| audit_logs | Audit logs |

### 6.3 IP Address Auto-Assignment

#### Device Access Subnet (wm-wg0)

Assigned based on `wg_default_subnet` (default `10.210.0.0/24`):

- **Nodes**: Starting from position `wg_node_ip_start` (default .1), e.g., 10.210.0.1, 10.210.0.2, ...
- **Devices**: Starting from position `wg_device_ip_start` (default .100), e.g., 10.210.0.100, 10.210.0.101, ...

Assignment logic: Query used IPs, find the next available IP; deleted IPs can be reused.

#### Tunnel Subnet (wm-tun*)

Assigned based on `tunnel_subnet` (default `10.211.0.0/16`), each tunnel is allocated a /30 subnet (2 usable IPs).

Tunnel ports are assigned incrementally starting from `tunnel_port_start` (default 41830).

---

## 7. Page Structure

```
/setup                          # First-time initialization page
/login                          # Login page

/dashboard                      # Dashboard (home page)

/nodes                          # Node list
/nodes/new                      # Create node
/nodes/:id                      # Node details/edit
/nodes/:id/script               # Install script

/devices                        # Device list
/devices/new                    # Create device
/devices/:id                    # Device details/edit
/devices/:id/config             # Client configuration

/lines                          # Line list
/lines/new                      # Create line
/lines/:id                      # Line details/edit

/filters                        # Routing rule list
/filters/new                    # Create rule
/filters/:id                    # Rule details/edit

/settings                       # System settings
/settings/logs                  # Audit logs
/help                           # Help page
```

---

## 8. Background Tasks (Worker)

The Worker process runs in the same container as Next.js and begins execution after a 30-second delay on startup.

| Task | Frequency | Description |
|------|-----------|-------------|
| Node health check | 5 minutes | Check Agent's last report time; mark as offline if exceeding 10 minutes |
| Line status sync | 5 minutes | Update line active/inactive status based on node online status |
| Monitoring data cleanup | 1 hour | Clean up node_status records older than 7 days |
| Pending-delete node cleanup | 1 hour | Clean up nodes with pending_delete status older than 7 days |

---

## 9. Install Script

The install script is dynamically generated by `GET /api/nodes/:id/script`. Main stages:

1. **Environment detection**: Root privileges, architecture detection (amd64/arm64), OS version detection, kernel version check (warn if <5.6), systemd check, connectivity check, disk space check
2. **Install dependencies**: WireGuard (wireguard + wireguard-tools), iptables, ipset; uses apt/yum/dnf depending on OS
3. **Download binaries**: Download Agent and Xray tar.gz from management platform (by architecture), SHA256 verification, retry 3 times on failure
4. **Configure WireGuard**: Write wm-wg0.conf, enable ip_forward, start interface using `ip link` + `wg setconf` (does not use wg-quick)
5. **Deploy Xray**: Extract Xray binary, register wiremesh-xray.service (enable but do not start — managed by Agent)
6. **Deploy Agent**: Extract Agent binary, write agent.yaml, register wiremesh-agent.service and start

The script supports upgrade mode (skips certain steps when an existing installation is detected).

---

## 10. Docker Deployment

### 10.1 docker-compose.yml

```yaml
services:
  wiremesh:
    image: ghcr.io/hitosea/wiremesh:latest
    build:
      context: .
      args:
        AGENT_VERSION: ${AGENT_VERSION:-dev}
    ports:
      - "3456:3000"
    volumes:
      - ./data:/app/data
    environment:
      - JWT_SECRET=${JWT_SECRET:-<built-in-default>}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-<built-in-default>}
      - PUBLIC_URL=${PUBLIC_URL:-http://localhost:3456}
      - HOSTNAME=0.0.0.0
    restart: unless-stopped
```

### 10.2 Dockerfile

Four-stage build:

1. **xray-downloader** (alpine): Download Xray dual-architecture binaries from GitHub, package as tar.gz
2. **agent-builder** (golang:1.25-alpine): Compile Agent dual-architecture binaries (CGO_ENABLED=0), version number read from package.json, package as tar.gz
3. **builder** (node:20-alpine): `npm install` + `npm run build` to build Next.js
4. **runner** (node:20-alpine): Copy standalone artifacts, static files, Drizzle migrations, Worker, Agent and Xray binary packages

Startup command: `node worker/index.js & node server.js`

---

## 11. Sensitive Data Encryption

### 11.1 Encryption Scheme

AES-256-GCM symmetric encryption. Key is injected via the `ENCRYPTION_KEY` environment variable (64-character hex string = 32 bytes). Each encryption uses a random 12-byte IV.

Storage format: `Base64( IV + AuthTag + Ciphertext )`

### 11.2 Encrypted Fields

| Table | Field | Description |
|-------|-------|-------------|
| nodes | wg_private_key | Node WireGuard private key |
| nodes | reality_private_key within xray_config | Xray Reality private key |
| devices | wg_private_key | Device WireGuard private key |
| devices | socks5_password | SOCKS5 password |
| line_tunnels | from_wg_private_key | Tunnel from-end private key |
| line_tunnels | to_wg_private_key | Tunnel to-end private key |

---

## 12. Non-Functional Requirements

| Item | Requirement |
|------|-------------|
| Responsive Design | Adapted for desktop and tablet; no mobile optimization needed |
| Security | Sensitive data encrypted with AES-256-GCM; all admin APIs require JWT authentication; Agent APIs use node-level token authentication |
| Performance | SQLite is sufficient for a single-admin use case; server-side pagination to avoid large data transfers |
| Logging | Key operations logged in the audit_logs table |
| Internationalization | Chinese + English, using next-intl routeless mode |
| Error Handling | Record error messages on config sync/install failures; highlight on Dashboard |
