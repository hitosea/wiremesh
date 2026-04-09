## Overview

WireMesh is a WireGuard mesh VPN management platform for internal use. It lets you manage VPN infrastructure from a central web UI without manually editing WireGuard configuration files on each server.

**Core concepts:**

- **Nodes** — Linux servers running the `wiremesh-agent` binary. Each node has a public IP and connects to the management platform over SSE. Nodes form the backbone of the VPN network.
- **Devices** — Client endpoints (laptops, phones) that connect to the VPN. Each device gets a WireGuard or Xray configuration.
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
   - **Enable Xray** (optional toggle) — when enabled, shows Xray Start Port (default 41443) and Reality Target (default `www.microsoft.com:443`).
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

You can also edit the node's name, IP, domain, WG port, Xray settings, tags, and notes from this page.

### Uninstalling the Agent

To cleanly remove the Agent from a server, run the uninstall script:

```
curl -fsSL 'https://your-platform/api/uninstall-script' | bash
```

This is a generic script that works on any node without requiring authentication. It stops and removes the `wiremesh-agent` and `wiremesh-xray` services, tears down all WireGuard interfaces (`wm-wg0`, `wm-tun*`), cleans up iptables rules, ip rules, routing tables, ipsets, and deletes the `/etc/wiremesh/` directory and agent binaries. System packages (wireguard, iptables, ipset) are not removed as they may be used by other software.

### Deleting a Node

Delete a single node from the list page via the delete button, or select multiple nodes and use **Batch Delete**. A confirmation dialog is shown before deletion. You can also batch-update tags for selected nodes.

---

## Device Management

### Adding a Device

1. Go to **Devices → Add Device**.
2. Fill in the form:
   - **Device Name** (required).
   - **Protocol** (required) — choose **WireGuard** or **Xray**.
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

### Viewing Device Details

Click a device to see its detail page with protocol info, WireGuard address/public key (or Xray UUID), and last handshake time. You can edit the device's name, tags, notes, and line assignment.

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

### Creating a Rule

1. Go to **Filter Rules → Add Rule**.
2. Fill in the form:
   - **Rule Name** (required).
   - **Mode** (required) — **Whitelist** or **Blacklist**.
   - **IP Rules** (optional) — one IP/CIDR per line.
   - **Domain Rules** (optional) — one domain pattern per line.
   - **Source URL** (optional) — a URL to fetch rules from automatically.
   - **Linked Branches** — select which line branches this rule applies to.
   - **Tags** and **Notes** (optional).
3. At least one of IP rules, domain rules, or source URL must be provided.
4. Click **Save**.

### Managing Rules

From the detail page you can edit all fields. If a source URL is configured, the page shows the last sync time and a **Sync Now** button to manually fetch updated rules.

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
