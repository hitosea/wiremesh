## Overview

WireMesh is a WireGuard mesh VPN management platform for internal use. It lets you manage VPN infrastructure from a central web UI without manually editing WireGuard configuration files on each server.

**Core concepts:**

- **Nodes** — Linux servers running the `wiremesh-agent` binary. Each node has a public IP and connects to the management platform over SSE. Nodes form the backbone of the VPN network.
- **Devices** — Client endpoints (laptops, phones) that connect to the VPN through an entry node. Each device gets a WireGuard or Xray VLESS Reality configuration.
- **Lines** — Multi-hop routes that chain nodes together: entry → (optional relay) → exit. Traffic from a device enters at the entry node and exits at the exit node, tunneled through WireGuard interfaces between hops.
- **Filter Rules** — Domain- or IP-based routing rules assigned to a line. They let you route specific traffic (e.g., streaming services, corporate subnets) through a particular line while other traffic uses a different path.

---

## Dashboard

The dashboard gives a real-time snapshot of your network health.

**Metric cards:**

| Card | What it shows |
|------|---------------|
| Total Nodes | All registered nodes |
| Online Nodes | Nodes with an active Agent connection |
| Total Devices | All provisioned client devices |
| Online Devices | Devices seen connected in the last 5 minutes |
| Total Lines | All configured lines |
| Active Lines | Lines that are enabled and have all hops online |

**Status indicators** use color badges: green = online/active, red = offline/error, gray = disabled. An **error** state means the Agent is reachable but reported a configuration or WireGuard interface problem.

**Recent Activity** lists the latest node status changes, device connections, and configuration deployments, newest first.

---

## Node Management

### Adding a Node

1. Go to **Nodes → Add Node**.
2. Enter a name, the server's public IP address, and optional notes.
3. Click **Save**. WireMesh generates a one-time install script.
4. Copy the script and run it on the server as root. It downloads `wiremesh-agent`, installs it to `/etc/wiremesh/`, and starts `wiremesh-agent.service`.
5. The node status changes to **online** within a few seconds once the Agent connects via SSE.

**Firewall requirements:** UDP 41820 must be open for device access. Tunnel ports (41830+/UDP) must be open between nodes that share a line.

### Viewing Node Details

Click a node row to open its detail page. You can see:

- **Status history** — uptime/downtime events over the last 7 days.
- **Latency chart** — round-trip latency from the management platform.
- **Traffic chart** — inbound/outbound bytes per interval.

### Deleting a Node

Open the node detail page and click **Delete**. If the node is used in any line, you will see a warning listing the affected lines. Remove the node from those lines first, then delete.

---

## Device Management

### Adding a Device

1. Go to **Devices → Add Device**.
2. Enter a device name.
3. Select an **entry node** — the node this device will connect to.
4. Choose a protocol:
   - **WireGuard** — standard WireGuard config; works on most clients.
   - **Xray VLESS Reality** — obfuscated transport; harder to detect/block.
5. Click **Save**. WireMesh auto-assigns an IP from the device subnet (10.210.0.0/24, starting at .100), generates WireGuard key pairs, and configures the device as a peer on the entry node's `wm-wg0` interface.

### Deploying the Config

- Click **Download Config** to get a `.conf` file (WireGuard) or a JSON/URI (Xray).
- Click **Show QR Code** to scan directly with a mobile client.

### Viewing Device Details

The device detail page shows current online status, the assigned VPN IP, and traffic in/out totals.

### Deleting a Device

Open the device detail page and click **Delete**. The device's WireGuard peer is removed from the entry node on the next config push.

---

## Line Orchestration

### Creating a Line

1. Go to **Lines → Create Line** and enter a name.
2. Select an **entry node** (where devices enter), an optional **relay node** (middle hop), and an **exit node** (where traffic leaves to the internet).
3. Click **Save**.

WireMesh automatically:
- Allocates a /30 subnet per tunnel from the tunnel subnet (10.211.0.0/16).
- Assigns tunnel ports starting from 41830/UDP, incrementing per line.
- Generates WireGuard key pairs for each tunnel segment and stores them in `line_tunnels`.
- Pushes the configuration to each involved node via SSE.

WireGuard interfaces on nodes use the prefix `wm-tun1`, `wm-tun2`, etc. for tunnel links.

### Managing Lines

- **Enable/Disable** — Toggle the line status from the line list or detail page. Disabling tears down the WireGuard tunnels on the nodes without deleting the configuration.
- **Line Status** — The detail page shows each hop's connectivity (entry↔relay, relay↔exit) with latency and packet-loss indicators.
- **Delete** — Removes tunnel configuration and pushes cleanup to all nodes. Active device sessions through this line will drop.

---

## Filter Rules

Filter rules let you steer specific traffic through a chosen line instead of the default route.

### Creating a Rule

1. Go to **Filter Rules → Add Rule**.
2. Enter a rule name.
3. Set the **match pattern** and type:
   - **Domain suffix** — matches a domain and all subdomains (e.g., `netflix.com`).
   - **Domain keyword** — matches any domain containing the keyword.
   - **IP CIDR** — matches a destination IP range (e.g., `192.168.10.0/24`).
4. Set **priority** — lower numbers are evaluated first (e.g., priority 10 runs before priority 100).
5. Select the **target line** that matching traffic should use.
6. Click **Save**, then toggle the rule **enabled**.

### Rule Evaluation

Rules are evaluated top-to-bottom by priority for each outbound connection. The first matching rule wins. Traffic that matches no rule uses the default route.

Disable a rule with the toggle on the rule list to stop it from matching without deleting it.

---

## System Settings

Go to **Settings** to adjust global network parameters.

**Network settings:**

| Setting | Default | Notes |
|---------|---------|-------|
| Device subnet | 10.210.0.0/24 | IP range for client devices; nodes start at .1, devices at .100 |
| Tunnel subnet | 10.211.0.0/16 | IP range for inter-node tunnels; /30 per tunnel segment |

**Port settings:**

| Setting | Default | Notes |
|---------|---------|-------|
| WireGuard port | 41820/UDP | Device-facing port (wm-wg0 interface) on entry nodes |
| Tunnel port start | 41830/UDP | First port used for node-to-node tunnels; increments per line |
| Xray port start | 41443/TCP | First port used for Xray listeners; increments per line |

**DNS settings** — Set the DNS resolver address pushed to device configurations.

**Audit Logs** — The Settings page includes a read-only audit log showing configuration changes with timestamps and affected resources.

---

## FAQ

**Node shows offline after installation**
- SSH into the server and check: `systemctl status wiremesh-agent.service`
- Review logs: `journalctl -u wiremesh-agent.service -n 50`
- Confirm the server can reach the management platform on the SSE endpoint (outbound HTTPS).
- Verify no firewall is blocking the outbound connection.

**Device can't connect to the VPN**
- Check the entry node is online in the Nodes list.
- Confirm UDP 41820 is open on the entry node's firewall.
- Re-download or re-scan the device config — the keys may have been rotated.
- On Linux clients, run `wg show` to see if the handshake completed.

**Line is enabled but traffic isn't routing**
- Open the line detail page and check each hop's status. All hops must be online.
- Confirm that the tunnel ports (41830+/UDP) are open between each pair of nodes in the line.
- Check `wg show` on the involved nodes to verify `wm-tun*` interfaces are up and handshaking.
- Disable and re-enable the line to force a config re-push.

**How to change network or port settings**
- Go to **Settings**, update the values, and save.
- Changing subnets or ports requires re-deploying affected nodes. Go to each node's detail page and click **Redeploy Config** to push the updated addresses and regenerate device configs.
- Devices will need their configs re-downloaded after a subnet change.
