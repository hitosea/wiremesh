## Overview

WireMesh is a WireGuard mesh VPN management platform for internal use. It lets you manage VPN infrastructure from a central web UI without manually editing WireGuard configuration files on each server.

**Core concepts:**

- **Nodes** — Linux servers running the `wiremesh-agent` binary. Each node has a public IP and connects to the management platform over SSE. Nodes form the backbone of the VPN network.
- **Devices** — Client endpoints (laptops, phones) that connect to the VPN. Each device gets a WireGuard, Xray, or SOCKS5 configuration.
- **Lines** — Multi-hop routes that chain nodes together. Each line has an entry node and one or more branches, where each branch defines a chain of relay and exit nodes. Devices are assigned to a line to determine their traffic path.
- **Filter Rules** — Domain- or IP-based routing rules linked to line branches. They control which traffic goes through which branch, supporting whitelist and blacklist modes.

---

## Dashboard

The dashboard gives a real-time snapshot of your network health.

### Metric Cards

Three summary cards are displayed:

- **Nodes** — Total count, with online (green), offline (gray), and error (red, shown only if > 0) breakdowns.
- **Devices** — Total count, with online (green) and offline (gray) breakdowns.
- **Lines** — Total count, with active (green) and disabled (gray) breakdowns.

### Status Tables

Below the cards, three tables provide quick access to recent status:

- **Node Status** — Lists recent nodes with name, IP, and current status indicator.
- **Device Status** — Lists recent devices with name, protocol, and status.
- **Node Traffic** — Shows per-node upload/download bytes with a total row (only displayed when traffic data exists).

---

## Node Management

### Adding a Node

1. Go to **Nodes → Add Node**.
2. Fill in the form:
   - **Name** (required) — a descriptive name for the node.
   - **IP Address** (required) — the server's public IP.
   - **Domain** (optional) — a domain name pointing to the server.
   - **WG Port** (optional) — WireGuard listen port, defaults to 41820.
   - **Tags** (optional) — comma-separated tags for organizing nodes.
   - **Notes** (optional) — free-text remarks.
   - **Proxy Base Port** (optional) — the starting port for the Xray and SOCKS5 shared port pool, defaults to 41443. Each line is automatically assigned a unique port.
   - **Reality Target** (optional) — Xray Reality camouflage target, must support TLS 1.3, defaults to `www.microsoft.com:443`.
3. Click **Save**.

### Installing the Agent

After saving, go to the node's **Install Script** page. You will see a one-click install command:

```
curl -fsSL 'https://your-platform/api/nodes/{id}/script?token=...' | bash
```

Copy and run it on the server as root. The script automatically downloads `wiremesh-agent`, creates `/etc/wiremesh/`, and starts `wiremesh-agent.service`.

### Verifying Connection

Refresh the node list. The node status changes to **online** once the Agent connects, typically within 30 seconds.

**Firewall requirements:** UDP 41820 must be open for device access. Tunnel ports (41830+/UDP) must be open between nodes that share a line.

### Viewing Node Details

Click a node row to open its detail page. You can see:

- **Read-only info** — WireGuard internal address, public key, agent token, and error message (if any).
- **Latency chart** — round-trip latency from the management platform over time.
- **Traffic chart** — upload/download bytes over time.

You can also edit the node's name, IP, domain, WG port, Xray / SOCKS5 settings, tags, and notes from this page.

### Version Management

The **Agent** and **Xray** columns in the node list show the version currently running on each node. The Agent reports version information with every status heartbeat. If the version shows "Unknown", the node is running an older Agent that does not support version reporting — re-run the install script on that server to upgrade.

### Upgrading the Agent

When a new Agent binary is deployed to the management platform, you can remotely upgrade nodes:

- **Single upgrade** — Click the **Upgrade** button next to a node in the list.
- **Batch upgrade** — Select multiple nodes and click **Upgrade All**. Batch upgrades are sent in waves of 5 nodes with a 3-second interval to avoid overwhelming the platform with concurrent downloads.

During the upgrade, the node status shows **Upgrading**. The Agent automatically downloads the new binary, verifies the SHA256 checksum, backs up the old version to a `.backup` file, replaces the binary, and performs a graceful restart. The node returns to online status once the upgrade completes.

If an upgrade fails, you can SSH to the node and roll back manually:

```
mv /usr/local/bin/wiremesh-agent.backup /usr/local/bin/wiremesh-agent
systemctl restart wiremesh-agent
```

> **Note:** Only online nodes can be remotely upgraded. Offline nodes require re-running the install script on the server.

### Deleting a Node

Delete a single node via the delete button, or select multiple nodes and use **Batch Delete**. Deletion also triggers remote uninstall:

- **Node is online** — The platform notifies the Agent via SSE to run the uninstall script, which cleans up all WireMesh components (services, interfaces, rules, config files, binaries). The database record is removed after cleanup completes.
- **Node is offline** — The node is marked as "pending delete". The Agent will automatically uninstall when it next comes online. If the node does not come back within 7 days, the record is cleaned up automatically.

### Manual Agent Uninstall

To manually uninstall without going through the management platform (e.g., the node cannot reach the platform), SSH to the server and run:

```
curl -fsSL 'https://your-platform/api/uninstall-script' | bash
```

This is a generic script that works on any node without requiring authentication. It stops and removes the `wiremesh-agent` and `wiremesh-xray` services, tears down all WireGuard interfaces (`wm-wg0`, `wm-tun*`), cleans up iptables rules, ip rules, routing tables, ipsets, and deletes the `/etc/wiremesh/` directory and agent binaries. System packages (wireguard, iptables, ipset) are not removed as they may be used by other software.

---

## Device Management

### Adding a Device

1. Go to **Devices → Add Device**.
2. Fill in the form:
   - **Device Name** (required).
   - **Protocol** (required) — choose **WireGuard**, **Xray**, or **SOCKS5**.
   - **Line** (optional) — assign the device to a line, or leave unassigned.
   - **Tags** (optional) — comma-separated tags.
   - **Notes** (optional).
3. Click **Save**. WireMesh auto-assigns an IP and generates keys.

### Getting the Config

Go to the device's **Config** page to:

- **View** the full configuration in a code block.
- **Copy** the config to clipboard.
- **Download** the config as a file.
- **Scan QR Code** — for mobile clients.

For Xray devices, additional tabs show:
- **Share Link** — a VLESS URI for one-click import.
- **Shadowrocket** — manual configuration fields (address, port, UUID, TLS settings).
- **Clash Meta** — YAML config for Clash-compatible clients.

For SOCKS5 devices, the config page shows a proxy URL (`socks5://username:password@host:port`). Configure it in your system or browser proxy settings.

### Viewing Device Details

Click a device to see its detail page with protocol info, WireGuard address/public key, Xray UUID, or SOCKS5 proxy address. You can edit the device's name, tags, notes, and line assignment.

### Deleting a Device

Delete from the list page via the delete button, or select multiple devices for **Batch Delete**. You can also batch-switch the line assignment for selected devices.

---

## Line Orchestration

Lines define how traffic flows from entry to exit through the network.

### Creating a Line

1. Go to **Lines → Create Line**.
2. Fill in a **line name**, optional tags and notes.
3. Select an **entry node** — where devices connect.
4. Add one or more **branches**:
   - Each branch has a **name** and a node chain (relay nodes + exit node).
   - Click **Add Transit** to insert relay nodes in the chain.
   - Select **filter rules** to associate with each branch.
   - Mark one branch as the **default branch** — traffic that matches no filter rule goes through this branch.
5. Click **Save**.

WireMesh automatically allocates /30 subnets from the tunnel subnet (10.211.0.0/16), generates WireGuard key pairs, assigns tunnel ports (from 41830/UDP), and pushes configuration to all involved nodes.

### Managing Lines

- **Enable/Disable** — Change the line status between active and inactive from the detail page. Disabling stops traffic forwarding without deleting the configuration.
- **Line Detail** — Shows entry node and status, branch topology with node chains and associated filters, tunnel info table (hop index, source/target nodes, WireGuard addresses and ports), and related device count.
- **Delete** — Removes tunnel configuration from all nodes.

---

## Filter Rules

Filter rules control traffic routing by matching domain names or IP addresses. Each rule operates in **whitelist** or **blacklist** mode and is linked to specific line branches.

### Rule Format

All rule fields are plain text with one entry per line. Lines starting with `#` are treated as comments and blank lines are ignored:

- **IP Rules** — one single IP (e.g. `8.8.8.8`) or CIDR range (e.g. `10.0.0.0/8`) per line, matched exactly.
- **Domain Rules** — one domain per line, **suffix-matched** against all subdomains. `openai.com` also matches `chat.openai.com` and `api.openai.com`. Prefixes, keywords, and regular expressions are not supported.
- **Source URL** — a plain-text file with one CIDR or domain per line; each line is auto-classified as IP or domain. **Not supported**: dnsmasq format (`server=/...`), Clash/Shadowrocket tag syntax (`DOMAIN-SUFFIX,xxx`), v2ray `geoip.dat` / `geosite.dat` binaries.
- **Mode** — Whitelist: matching traffic goes through this branch. Blacklist: matching traffic is blocked from this branch.

The **Rule format help** panel at the top of the rule editor page also lists the full conventions for quick reference.

### Creating a Rule

1. Go to **Filter Rules → Add Rule**.
2. Fill in the form:
   - **Rule Name** (required).
   - **Mode** (required) — **Whitelist** or **Blacklist**.
   - **IP Rules** (optional) — one IP/CIDR per line.
   - **Domain Rules** (optional) — one domain per line.
   - **Source URL** (optional) — a URL to fetch rules from automatically.
   - **Linked Branches** — select which line branches this rule applies to. **At least one branch must be linked** for the rule to take effect, and external source URLs require the entry node of the linked branch's line to trigger a sync.
   - **Notes** (optional).
3. At least one of IP rules, domain rules, or source URL must be provided.
4. Click **Save**.

### Managing Rules and Sync Feedback

From the detail page you can edit all fields. When a source URL is configured, the page shows sync-state feedback:

- **Last sync time** — recorded after the first successful sync; shows "Never synced" before then.
- **Sync status badge** — `✓ Sync succeeded` displays the number of IP and domain entries parsed; `✗ Sync failed` is followed by the error cause (HTTP status, connection failure, etc.).
- **Sync Now button** — click and the button is disabled showing "Syncing…" with a spinner. Once the agent finishes fetching, the result is pushed back over SSE and the UI updates **without a page refresh**.
  - Rule not yet linked to any branch → immediate error "This rule is not linked to any line branch, cannot sync".
  - Linked branch's line has no entry node → error "The linked branch's line has no entry node, cannot trigger sync".
  - No agent callback within 45 seconds (typically means the entry node agent is offline) → auto timeout with a prompt to check the agent.

---

## Subscription Groups

Subscription groups bundle multiple devices into a single URL that clients poll on a schedule. When you change a node's IP, swap an exit, or rotate keys on the platform, every client behind a subscription picks up the new config on its next refresh — no need to redistribute `.conf` files or share links by hand.

### Creating a Group

1. Go to **Subscription Groups → New Subscription**.
2. Fill in:
   - **Name** (required) — e.g. "All my devices".
   - **Remark** (optional) — purpose or context.
3. Click **Save**. A unique token is generated automatically.
4. Open the group's detail page and switch to the **Devices** tab to add existing devices to this group. A device may belong to multiple groups simultaneously.

### Subscription URLs

The **Subscription URLs** tab exposes the same group as eight client-specific URLs. Each URL serves the same set of devices, but in the format that client expects:

| Client | Platforms | Notes |
|--------|-----------|-------|
| Generic | Multi-platform fallback | Works with most V2Ray-family clients; WireGuard not supported. |
| Clash Verge | Android / iOS / macOS / Windows / Linux | Clash / Mihomo core — all protocols supported. |
| Shadowrocket | iOS | Supports WireGuard, VLESS, and SOCKS5. |
| Hiddify-Next | Android / iOS / macOS / Windows / Linux | Supports WireGuard, VLESS, and SOCKS5. |
| sing-box v1.12 | Android / iOS / macOS / Windows / Linux | Official sing-box v1.12+; ships with a clash-api controller (127.0.0.1:9090) for yacd / metacubexd dashboards. |
| V2RayN | Windows / macOS / Linux | V2Ray core — WireGuard not supported. |
| V2RayNG | Android | V2Ray core — WireGuard not supported. |
| Passwall | OpenWRT / Router | V2Ray family — WireGuard not supported. |

Each row has a **Copy link** button and a **Show QR** toggle. Choose the row that matches the client app the user is installing.

### Rotating the Token

If a subscription URL leaks, click **Rotate Token** in the detail page. The old URL stops working immediately and a fresh one is issued. All clients using the group must re-import the new link.

### Notes & Limitations

- **WireGuard devices on V2Ray-family subscriptions are silently skipped.** V2Ray core has no WireGuard outbound, so V2RayN / V2RayNG / Passwall / Generic subscriptions only carry the device's Xray and SOCKS5 entries. The detail page shows a warning when this applies.
- **Routing decisions stay on the server.** The subscription only delivers the device's *connection* config — which entry node, which key, which port. Domain / IP routing is enforced by filter rules on the entry node, not in the client. Keep the client side dumb so a config change here doesn't require touching every device.
- **Tokens are path-based** (`/api/sub/<token>/<client>`), not query strings. This makes them resilient to URL-trimming clients and easy to audit.
- **Deleting a group** invalidates its URLs immediately but does not delete the underlying devices — they remain available for direct config download or other groups.

---

## System Settings

Go to **Settings** to adjust global parameters. Settings are organized into groups:

### WireGuard

| Setting | Default | Description |
|---------|---------|-------------|
| Default Port | 41820 | WireGuard listen port for device access (wm-wg0) |
| Default Subnet | 10.210.0.0/24 | IP range for nodes and devices |
| Default DNS | 1.1.1.1 | DNS resolver pushed to device configs |
| Node IP Start | 1 | Starting IP offset for nodes in the subnet |
| Device IP Start | 100 | Starting IP offset for devices in the subnet |

### Tunnel

| Setting | Default | Description |
|---------|---------|-------------|
| Subnet | 10.211.0.0/16 | IP range for inter-node tunnels (/30 per tunnel) |
| Port Start | 41830 | First port for node-to-node tunnels |

### Filter

| Setting | Default | Description |
|---------|---------|-------------|
| Sync Interval | 86400 | Seconds between automatic source URL syncs |
| DNS Upstream | 8.8.8.8,1.1.1.1 | Upstream DNS servers for domain rule resolution |

### Change Password

Update your login password from the settings page. Enter current password, new password (minimum 6 characters), and confirm.

### Audit Logs

Audit logs are available at **Settings → Audit Logs** (separate page). They record all management operations with timestamps and affected resources.

---

## FAQ

**Node shows offline after installation**
- SSH into the server and check: `systemctl status wiremesh-agent.service`
- Review logs: `journalctl -u wiremesh-agent.service -n 50`
- Confirm the server can reach the management platform (outbound HTTPS).
- Verify no firewall is blocking the outbound connection.

**Device can't connect to the VPN**
- Check the entry node is online in the Nodes list.
- Confirm UDP 41820 is open on the entry node's firewall.
- Re-download the device config — it may be outdated.
- For Xray devices, check TCP 41443+ is also open.

**Line is enabled but traffic isn't routing**
- Open the line detail page and check each hop's status in the tunnel info table.
- Confirm tunnel ports (41830+/UDP) are open between each pair of nodes.
- Check the branch topology to verify the correct nodes are chained.
- Try setting the line to inactive then back to active to trigger a config re-push.

**How to change network or port settings**
- Go to **Settings**, update the values, and save.
- Changing subnets or ports affects existing configurations. Nodes will receive updated configs on the next sync, and device configs should be re-downloaded.
