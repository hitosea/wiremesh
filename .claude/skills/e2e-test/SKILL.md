---
name: e2e-test
description: Use when code changes affect Agent, routing, Xray, tunnels, or iptables logic and need full integration verification. Also use when user explicitly requests end-to-end testing or re-deployment of test nodes.
---

# WireMesh End-to-End Test

## Overview

Full integration test: clean slate → build → deploy → verify → Docker test. Covers WireGuard, Xray, and SOCKS5 across split-routing, direct, relay, dual-role, single-node, and shared-relay-with-mixed-role scenarios.

**Core principle:** Zero manual intervention on servers. All fixes must be in code. If something breaks, record it and fix the source.

**Language:** All progress updates, summaries, and results must be in Chinese (中文).

## Test Environment

Server IPs, the Xray TLS domain, SSH credentials, and the platform URL all live in `servers.env` (gitignored). Copy `servers.env.example` and fill in values before running this skill. Four servers are required, with fixed roles:

| Role | Variable | Notes |
|------|----------|-------|
| A | `WIREMESH_A_IP` + `WIREMESH_A_DOMAIN` | Entry, WS+TLS Xray (domain must resolve publicly for ACME) |
| B | `WIREMESH_B_IP` | Exit + Entry (dual role), REALITY Xray |
| C | `WIREMESH_C_IP` | Exit |
| D | `WIREMESH_D_IP` | Exit |

Admin credentials are always `admin / admin123` (re-initialised every Phase 1).

**At the start of every shell snippet in this skill, source the env loader:**
```bash
. .claude/skills/e2e-test/lib/load-env.sh
# now: $A_IP, $A_DOMAIN, $B_IP, $C_IP, $D_IP, $PLATFORM, $LOCAL_URL
```

### Transport Mode Assignment
- **Server A**: WebSocket + TLS (`xrayTransport: "ws-tls"`, `xrayTlsDomain: "$A_DOMAIN"`)
  After node creation, call `PUT /api/nodes/{A_ID}` with `{"xrayTransport":"ws-tls","xrayTlsDomain":"$A_DOMAIN"}`. ACME auto-cert will provision a Let's Encrypt certificate on first Agent config sync (requires port 80 accessible on A).
- **Server B**: REALITY (default, no extra config needed)
- This tests both transports coexisting: lines with A as entry use WS+TLS, lines with B as entry use REALITY

## Helper Scripts (under `.claude/skills/e2e-test/lib/`)

| Script | Purpose |
|--------|---------|
| `lib/load-env.sh` | Source it; exposes `$A_IP/$A_DOMAIN/$B_IP/$C_IP/$D_IP/$PLATFORM/$LOCAL_URL`. Aborts if `servers.env` is missing or incomplete. |
| `lib/wm-ssh.sh <host> <cmd>` | SSH wrapper using credentials from `servers.env`. Replaces inline `sshpass` calls. |
| `lib/build-image.sh` | Builds the `wm-test` Docker image (alpine + wireguard-tools + curl + iptables + xray binary baked in). Tag is content-hashed: cached image is reused across runs. Stdout is the resolved tag. |
| `lib/run-test.sh <id> <name> <proto> <line> <expected>` | Run one device's traffic test. Used by the batch runner — call directly only for ad-hoc debugging. |
| `lib/batch-test.sh [-j N] [-o results.tsv] <matrix.tsv>` | Run a TSV matrix in parallel (default `-j 8`). Returns the number of failed devices; writes `results.tsv` for forensics. |

The matrix file is tab-separated: `<id>\t<name>\t<protocol>\t<line_id>\t<expected_csv>`. `expected_csv` uses comma-separated `key=letter` pairs (e.g. `ifconfig.me=B,ip.me=C,icanhazip.com=D`); letters map back to `$A_IP/$B_IP/$C_IP/$D_IP`.

## Known Pitfalls

| Pitfall | Correct Approach |
|---------|-----------------|
| API settings fields are **snake_case** | `wg_default_port`, `xray_default_port`, `tunnel_port_start` — NOT camelCase |
| Install script endpoint | `GET /api/nodes/{id}/script` — NOT `/api/nodes/{id}/install-script` |
| Settings must be set BEFORE creating nodes | Nodes inherit default ports at creation time |
| Dev server port and DB refresh | Use `PORT=3456 npm run dev`. After DB wipe, must restart dev server (Next.js caches DB state) |
| Use localhost for API calls | `$LOCAL_URL` (typically `http://localhost:3456`) with cookie auth. External Coder URL strips custom headers |
| `/api/agent/*` paths bypass auth | Real Agents have no cookie; the proxy middleware (`src/proxy.ts`) lets `/api/agent/*` through. Test fixtures used by Agents (e.g. `sourceUrl` filters in Phase 8f) must live under this prefix |
| Cross-branch filter binding regressions | The `ip.me group` filter is intentionally bound to BOTH Split branch-2 (→ C) and Split-Direct branch-10 (→ A direct-exit) — same domain, two ipsets. This is the canonical regression case for `agent/dns/rules.go` multi-binding (commit `d2b2020`). Don't "simplify" the test data by removing one binding |

Test Docker image is built once via `lib/build-image.sh` (content-hashed tag — re-uses the cached image across runs). The Dockerfile bakes the dev machine's Xray binary into the image so `docker run` no longer needs a `-v` mount or `apk add`. First Phase 2 build takes ~10s; later runs are instant.

## Phases

### 1. Clean Slate
- Clear platform database (`rm -f data/wiremesh*` — includes .db, .db-shm, .db-wal), restart dev server, then re-initialize admin account via `POST /api/setup`
- SSH into all 4 servers and run the uninstall script. Use the helper:
  ```bash
  for HOST in "$A_IP" "$B_IP" "$C_IP" "$D_IP"; do
      .claude/skills/e2e-test/lib/wm-ssh.sh "$HOST" "curl -fsSL '$PLATFORM/api/uninstall-script' | bash" &
  done
  wait
  ```
  The script stops services, removes interfaces, cleans iptables/ip rules/ipsets with `wm-` prefix, deletes `/etc/wiremesh/` and agent binaries.

### 2. Build Agent
- Build both `linux/amd64` and `linux/arm64`, package as `tar.gz`
- **Binary name inside tar must be `wiremesh-agent`** (no arch suffix). The install script expects `chmod +x /usr/local/bin/wiremesh-agent` after extraction.
- **Version injection required**: use `-ldflags "-X main.Version=X.Y.Z"` to embed the version at build time. The version must NOT have a "v" prefix. Read it from `package.json` or specify manually. Example:
  ```bash
  cd agent
  VERSION="1.0.0"
  for ARCH in amd64 arm64; do
    CGO_ENABLED=0 GOOS=linux GOARCH=$ARCH go build -ldflags "-X main.Version=$VERSION" -o wiremesh-agent .
    tar czf ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz wiremesh-agent
    sha256sum ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz > ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz.sha256
    rm wiremesh-agent
  done
  echo -n "$VERSION" > ../public/agent/agent-version.txt
  ```
- **Checksum and version files** (`.sha256` and `agent-version.txt`) must be generated alongside the tar.gz — they are read by the binary API endpoints for `X-Agent-Version` and `X-Agent-Checksum` response headers
- Also generate Xray checksum/version files if not already present:
  ```bash
  sha256sum public/xray/xray-linux-amd64.tar.gz > public/xray/xray-linux-amd64.tar.gz.sha256
  sha256sum public/xray/xray-linux-arm64.tar.gz > public/xray/xray-linux-arm64.tar.gz.sha256
  echo -n "26.3.27" > public/xray/xray-version.txt
  ```
- Output to `public/agent/` so `/api/agent/binary` serves the new version
- Xray binaries are pre-packaged in `public/xray/` — no need to download from GitHub
- Both Agent and Xray are downloaded by the install script from the platform automatically
- Verify `/api/agent/binary?arch=amd64` returns correct `X-Agent-Version` header via HEAD request
- **Build the test Docker image once for this run** (cached on later runs):
  ```bash
  .claude/skills/e2e-test/lib/build-image.sh
  ```
  The tag is content-hashed (`wm-test:<xray-version>-<arch>-<sha8>`); when cached the script returns instantly.

### 3. Randomize Ports
- Pick a random base port in the range 20000–49800
- Update system settings via `PUT /api/settings`:
  - `wg_default_port` = base
  - `xray_default_port` = base + 100
  - `tunnel_port_start` = base + 200
- This ensures every test run uses different ports, verifying the system doesn't depend on hardcoded defaults
- Log the chosen ports for debugging if later phases fail

### 4. Platform Data
- 4 nodes — IPs come from `$A_IP/$B_IP/$C_IP/$D_IP`. Server A also gets `domain: $A_DOMAIN`.
- After creating A, set it to WS+TLS: `PUT /api/nodes/{A_ID}` with `{"xrayTransport":"ws-tls","xrayTlsDomain":"$A_DOMAIN"}` (see Transport Mode Assignment above)
- 5 filters:
  - `icanhazip group` (domainRules: `icanhazip.com`) — bound to Split branch-3 (→ D). The Expected Results "icanhazip.com" column is the third tested URL for non-Smart devices; `ifconfig.me` itself is intentionally **un**filtered so it falls through to the default branch.
  - `ip.me group` (domainRules: `ip.me`)
  - `ip.sb group` (domainRules: `ip.sb`) — NEW, used by Split-Direct branch 2
  - `overseas services` (domainRules)
  - `China` (sourceUrl: `https://raw.githubusercontent.com/gaoyifan/china-operator-ip/ip-lists/china.txt`, mode: whitelist) — NEW, external IP list covering three major Chinese carriers (~4000+ CIDRs)
- 7 lines: split-routing (A→B/C/D), direct (A→B), relay (A→B→C), reverse (B→A), single-node (B only, nodeIds=[] for entry=exit), **split-direct (A→B/C/[] — third branch has nodeIds=[] for branch-level direct-exit)**, **shared-relay (A→B→C / A→B→D / A→B — same node B is relay in two branches AND exit in a third, exercising per-branch role resolution)**
- 16 devices: see Expected Results table (WG + Xray + SOCKS5)

#### Split-Direct Line Configuration
Exercises features not covered by other lines: per-branch direct-exit (entry acts as exit for one branch while other branches tunnel out), external `sourceUrl` IP lists, and multi-filter-per-branch union semantics. Also exercises the dual-ipset model (`wm-branch-N-cidr` + `wm-branch-N-dns`) by binding both a `sourceUrl` filter and a `domainRules` filter to the same branch.

- Entry: **A**
- Branch 1 (default): exit **B**, no filter
- Branch 2: exit **C**, filter `ip.sb group` (→ traffic for `ip.sb` routes to C)
- Branch 3: **nodeIds=[] (direct-exit at A)**, filters `ip.me group` + `China`
  - Domain match for `ip.me` → DNS proxy populates `wm-branch-{id}-dns` on resolution → routes to A
  - IP match for Chinese CIDRs → static population of `wm-branch-{id}-cidr` via `ipset swap` on external fetch → routes to A
  - Both filters bound to the same branch; union semantics (either match routes to A)

Two new devices both attach to this line: `Smart-WG` (WG) and `Smart-Xray` (Xray).

#### Shared-Relay Line Configuration
Exercises **per-branch role resolution**: the same node B serves as **relay** in two branches and as **exit** in a third — a topology that previously broke because `agent/config/route.ts` keyed forwarding state by `lineId`, collapsing all of B's roles for this line onto a single iface and silently dropping traffic for the redundant branches.

- Entry: **A**
- Branch 1 (default): **A → B → C**, no filter (B is relay, C is exit)
- Branch 2: **A → B → D**, filter `icanhazip group` (B is relay AGAIN — second binding for this filter alongside the existing Split branch-3 binding; traffic for `icanhazip.com` routes to D)
- Branch 3: **A → B**, filter `ip.me group` (B is **exit** — third binding for this filter alongside Split branch-2 and Split-Direct branch-10; traffic for `ip.me` routes back out at B)

One device attaches to this line: `SharedRelay-WG` (WG). One device is sufficient — the bug lives in the routing/iptables generation, not in any per-protocol path.

### 5. Install Agents
- Get install scripts via API, run in parallel on all 4 servers
- Verify all nodes report "online"

### 6. Server Verification (read-only SSH)
Entry node: WG peers, tunnel handshakes, Xray ports, SOCKS5 ports, ipset, iptables (PREROUTING + OUTPUT + NAT), ip rules, DNS proxy.
Exit nodes: tunnel handshakes, NAT MASQUERADE, return routes.
Dual-role node: both entry and exit tunnels, Xray, MASQUERADE.
Single-node entry=exit: verify NO tunnels created, iptables has wm-wg0 → extIface FORWARD + MASQUERADE, SOCKS5 listening.

#### Agent log cleanliness checks (every node)
Run on each entry node — these patterns indicate concrete regressions, not noise:

```bash
journalctl -u wiremesh-agent --since "5 minutes ago" --no-pager | grep -E \
  'sync\] add .* tmp .* failed.*does not exist|Sets cannot be swapped|initial rebuild .* failed'
```
Any match = ipset race regression (`agent/routing/sync.go` per-branch rebuild lock failed; commit `bea60f8`). The fix uses per-branch mutex around `rebuildBranchCidrSet`; without it, eager rebuild during `UpdateSources` collides with the `fetchAndApply` goroutine on a fixed `.tmp` ipset name.

```bash
journalctl -u wiremesh-agent --since "5 minutes ago" --no-pager | grep -E \
  'bind: address already in use'
```
Any match = SOCKS5 listener race regression (`agent/socks5/server.go` lost `SO_REUSEADDR`/`SO_REUSEPORT`; commit `d2b2020`). Manager.Sync always restarts SOCKS5 listeners to pick up credential changes; without REUSE flags, the kernel hasn't released the old socket and the rebind fails with EADDRINUSE.

(Both checks should return zero matches.)

#### WS+TLS Verification (Server A)
- Check Xray config uses `"network": "ws"` and `"security": "tls"` (not `"tcp"` / `"reality"`)
- Check TLS cert files exist: `/etc/wiremesh/xray/$A_DOMAIN.crt` and `.key`
- If ACME auto-cert was triggered, check agent logs for `[acme]` entries
- If cert files are missing (ACME failed because port 80 is blocked), the agent log will show the error. In that case, manually upload a cert via `PUT /api/nodes/{id}` with `xrayTlsCert` and `xrayTlsKey` fields, wait for agent sync, then re-verify.
- Verify Xray is listening on the configured port with TLS by testing: `curl -s --connect-timeout 5 https://$A_DOMAIN:{xray_port}/ -k` (should get a response or TLS handshake, not connection refused)

#### REALITY Verification (Server B)
- Check Xray config uses `"network": "tcp"` and `"security": "reality"` (unchanged behavior)

#### Split-Direct Verification (Server A)
Verifies the dual-ipset routing model and the per-branch direct-exit plumbing. Run on Server A (entry for this line):

Dual-ipset presence and population:
- `ipset list -n | grep wm-branch-{branch3_id}` → returns **both** `wm-branch-{id}-cidr` and `wm-branch-{id}-dns`
- `ipset list wm-branch-{branch3_id}-cidr` → **Number of entries >= 4000** (China list loaded successfully via `ipset swap`)
- `ipset list wm-branch-{branch3_id}-cidr` → **References ≥ 1** (match-set mangle rule is live; will be **2** when the line also has Xray devices, because the Xray OUTPUT chain references the same ipset)
- `ipset list wm-branch-{branch3_id}-dns` → **References ≥ 1** (the DNS match-set rule survived all source syncs — the regression guard; same `=2` rule when Xray is on the line, e.g. Smart-Xray attached to Split-Direct)

Mangle rules (PREROUTING has exactly 2 rules per non-default branch — never more):
- `iptables -t mangle -S PREROUTING | grep wm-branch-{branch3_id}` → exactly **2 lines**:
  - one with `--match-set wm-branch-{id}-cidr dst` and comment `wm-branch-{id}-cidr`
  - one with `--match-set wm-branch-{id}-dns dst` and comment `wm-branch-{id}-dns`
- **NO inline CIDR rules** (i.e. rules with `-d 1.2.3.0/24` patterns). If you see thousands of inline rules, the Agent regressed to the pre-refactor code path.

Xray OUTPUT chain (on entry nodes running Xray):
- For the Split-Direct line, OUTPUT contains **2 rules per non-default branch** (cidr + dns) remarking Xray's per-line mark to the branch mark
- `iptables -t mangle -S OUTPUT | grep wm-xray-line-{splitdirect_line_id}` → at least 4 lines (2 branches × 2 ipsets)

Direct-exit plumbing on Server A:
- `ip route show table {branch3_mark}` → **`default via <gateway> dev eth0`** (NOT `dev eth0 scope link` — the `via` is required on cloud VMs behind NAT)
- `iptables -t nat -nvL POSTROUTING | grep wm-branch-{branch3_id}-direct` → MASQUERADE rule with `-s 10.0.0.0/8 -o eth0`
- `iptables -nvL FORWARD | grep wm-branch-{branch3_id}-direct` → bidirectional ACCEPT (wm-wg0↔eth0 with conntrack state)
- NO `wm-tun{N}` interface exists for this branch (direct-exit bypasses tunnels)

Agent logs (journalctl on Server A):
- One line per filter sync: `[sync] Rebuilt wm-branch-{branch3_id}-cidr: N entries (static=X external=Y)` where external ≈ 4000+
- NO lines like `[iptables] Removing: ... wm-branch-{id}-dns` from a SourceSyncer cycle (that would be the pre-refactor bug resurfacing)

#### Shared-Relay & Mixed-Role Verification (Server B)
Verifies per-branch role resolution on the SharedRelay line. Run on Server B (the shared relay/exit node). Let `{sr_b1_id}`, `{sr_b2_id}`, `{sr_b3_id}` be the three branch IDs of the SharedRelay line and `{sr_line_id}` the line ID.

Tunnel topology — B should have **5 tunnel interfaces** for this single line:
- `wg show interfaces | tr ' ' '\n' | grep -c '^wm-tun'` ≥ 5 (cumulative across all lines; subtract counts from other lines that route through B). The pre-fix bug created the same 5 tunnels but only wired forwarding for ~2 of them.
- `wg show all latest-handshakes` → all 5 SharedRelay tunnels show recent handshake (< 3 min) once a SharedRelay-WG client connects.

Per-tunnel role resolution — the killer test for the fix:
- For each of B's 5 SharedRelay tunnels, identify it by branch via `lineTunnels.fromWgPort` / `toWgPort` lookups, then check rules:
  - **Branches 1 & 2 (B is relay)** — both `from` (B→C / B→D) and `to` (A→B) tunnels must have:
    - `iptables -nvL FORWARD | grep -c "wm-tun{N}.*wm-line-{sr_line_id}"` → 2 lines (one `-i wm-tun{N}`, one `-o wm-tun{N}`)
    - For the `from` tunnel only: `iptables -t nat -S POSTROUTING | grep "wm-tun{N}"` → 1 MASQUERADE line with `-s 10.0.0.0/8`
    - **NO** `wm-tun{N} -o eth0` rule (that would be exit-style — regression)
  - **Branch 3 (B is exit)** — the single `to` tunnel (A→B for branch 3) must have:
    - `iptables -nvL FORWARD | grep "wm-tun{N}"` → exactly 2 lines, BOTH involving `eth0` (`-i wm-tun{N} -o eth0` and `-i eth0 -o wm-tun{N}` with `state RELATED,ESTABLISHED`)
    - `iptables -t nat -S POSTROUTING | grep -E "wm-line-{sr_line_id}.*MASQUERADE"` → at least one line with `-o eth0 -s 10.0.0.0/8` (exit MASQUERADE; may be deduped against other lines' identical rules)
    - **NO** `-o wm-tun{N}` MASQUERADE rule (that would be relay-style — regression)

Per-branch relay deviceRoutes — `ip rule list` on B must contain **two distinct iif rules**, one per relay branch:
- `ip rule list | grep -c '^[0-9]*:.*iif wm-tun.*lookup'` ≥ 2 for SharedRelay relays (count cumulatively with any other relay lines on B; the pre-fix bug only ever installed one relay rule per line regardless of branch count)
- For each relay branch, the lookup table contains `default dev wm-tun{downstream_N}` matching that branch's downstream tunnel.

Critical regression sentinels (any match = the per-branch role refactor regressed):
- `iptables -nvL FORWARD | grep wm-tun{branch3_to_tunnel}` returns rules WITHOUT `eth0` → branch 3 was treated as relay instead of exit
- `iptables -nvL FORWARD | grep wm-tun{branch1_or_2_tunnel}` returns rules WITH `-o eth0` → relay tunnel was treated as exit
- `ip rule list | grep -c iif.*wm-tun` for SharedRelay = 1 → only one branch's relay forwarding got installed (Map-keyed-by-lineId regression)

### 7. Docker Container Testing
All containers run on the **local dev machine** (not on remote servers — containers simulate external clients connecting into the VPN). The container handling — `wg-quick up` for WG, local Xray client for Xray, `socks5h://` URL for SOCKS5 — is hidden inside `lib/run-test.sh`; this phase just builds a TSV matrix and calls the batch runner.

**Build the matrix** (16 device entries; substitute the device IDs returned by Phase 4's `POST /api/devices` calls into column 1):
```tsv
<id>	MacBook-WG	wireguard	<split_id>	ifconfig.me=B,ip.me=C,icanhazip.com=D
<id>	iPhone-WG	wireguard	<direct_id>	ifconfig.me=B,ip.me=B,icanhazip.com=B
… (rows 3-16 follow the Expected Results table; Smart-WG / Smart-Xray use the 4-column form)
<id>	Smart-WG	wireguard	<splitdirect_id>	ifconfig.me=B,ip.sb=C,ip.me=A,pconline=A
<id>	Smart-Xray	xray	<splitdirect_id>	ifconfig.me=B,ip.sb=C,ip.me=A,pconline=A
<id>	SharedRelay-WG	wireguard	<sharedrelay_id>	ifconfig.me=C,ip.me=B,icanhazip.com=D
```

**Run all 16 in parallel** (default `-j 8`, ~20 seconds wall-clock):
```bash
.claude/skills/e2e-test/lib/batch-test.sh /tmp/wm-matrix.tsv
```
Exit code = number of failed devices (0 = all pass). `results.tsv` in the skill dir holds the per-device summary line (gitignored).

#### Split-Direct Devices (Smart-WG / Smart-Xray): 4-column test matrix
These devices use the `Split-Direct` line to exercise dual-ipset routing. They get an additional cross-verification column (`pconline`) that hits a China-hosted IP-echo service to independently confirm exit IP:
- `https://ifconfig.me` → expects **B** (no filter match, default branch)
- `https://api.ip.sb/ip` → expects **C** (matches `ip.sb` domain → branch 2 → tunnel to C)
- `https://ip.me` → expects **A** (matches `ip.me` domain → branch 3 → direct-exit at A)
- `https://whois.pconline.com.cn/ipJson.jsp?ip=myip&json=true` → expects **A** (pconline's IP hit by China filter → direct-exit at A). The JSON response's `ip` field is the third-party-observed source IP — use this for authoritative cross-check. Decode GBK: `curl ... | iconv -f GBK -t UTF-8` for human-readable province name, but the `ip` field itself is ASCII.

The `pconline` check is the crucial regression guard for the dual-ipset model: a third-party server in China independently confirms that China-bound traffic is exiting from A (not leaking to B via default branch).

#### Internals (only useful when run-test.sh misbehaves)
The runner already handles the previously-painful edge cases — this list is for forensics, not for re-implementing in skill code:
- WG: `--privileged` container, `wg-quick up`, manual `/etc/resolv.conf` (Alpine has no `resolvconf`), 15s connect timeout for the first handshake.
- Xray: local Xray binary baked into the `wm-test` image; container starts it pointing at the API-supplied JSON config and curls through `socks5h://127.0.0.1:1080`.
- SOCKS5: forces `socks5h://` (DNS server-side) so `ip.me` doesn't return geo-bogus IPs.
- WS+TLS clients use `$A_DOMAIN` as the server address; DNS resolution from inside the container must succeed (the public DNS resolves it to Server A).

## Expected Results

| Device | Protocol | Line | ifconfig.me | ip.sb | ip.me | icanhazip.com | pconline |
|--------|----------|------|-------------|-------|-------|---------------|----------|
| MacBook-WG | WG | Split | B | — | C | D | — |
| iPhone-WG | WG | Direct | B | — | B | B | — |
| iPad-WG | WG | Relay | C | — | C | C | — |
| Windows-Xray | Xray | Split | B | — | C | D | — |
| Android-Xray | Xray | Direct | B | — | B | B | — |
| Tablet-Xray | Xray | Relay | C | — | C | C | — |
| Linux-WG | WG | Reverse | A | — | A | A | — |
| TV-Xray | Xray | Reverse | A | — | A | A | — |
| Router-SOCKS5 | SOCKS5 | Reverse | A | — | A | A | — |
| Phone-SOCKS5 | SOCKS5 | Direct | B | — | B | B | — |
| Laptop-WG | WG | Single-B | B | — | B | B | — |
| Desktop-SOCKS5 | SOCKS5 | Single-B | B | — | B | B | — |
| Camera-SOCKS5 | SOCKS5 | Relay | C | — | C | C | — |
| Smart-WG | WG | Split-Direct | B | C | **A** | — | **A** |
| Smart-Xray | Xray | Split-Direct | B | C | **A** | — | **A** |
| SharedRelay-WG | WG | SharedRelay | C | — | **B** | **D** | — |

A=47.84.135.129, B=47.236.3.88, C=47.245.89.95, D=47.84.231.26

Columns marked `—` are not tested for that device (the column is specific to a different line's filters). `Smart-*` devices use a 4-column matrix (ifconfig.me / ip.sb / ip.me / pconline); all other devices use the 3-column matrix (ifconfig.me / ip.me / icanhazip.com). `ifconfig.me` is the *unfiltered* probe — it must hit no domain rule on any line, so it always falls through to the default branch and reveals which exit a line's "no filter match" path is using.

### Single-Node Line Notes
- Line "Single-B": entry node = B, branches have empty nodeIds (no exit/relay nodes)
- No tunnels (wm-tun*) should be created for this line
- Traffic goes wm-wg0 → eth0 (or SOCKS5 → eth0) directly on node B
- iptables should have FORWARD wm-wg0 ↔ eth0 + MASQUERADE rules for this line

### Direct-Exit Branch Notes (Split-Direct line)
Distinct from single-node lines: in Split-Direct only **one branch** (branch 3) has `nodeIds=[]`, the other branches still tunnel to separate exit nodes. This is a **per-branch** direct-exit, not a per-line one.

- Line has tunnels (wm-tun{N}) for branches 1 and 2, but NOT for branch 3
- Branch 3's fwmark lookup table points at `eth0` with the system default gateway (`default via <gw> dev eth0`), NOT `default dev eth0 scope link` — this matters on cloud VMs behind NAT where eth0 is a private interface
- iptables has dedicated per-branch FORWARD + MASQUERADE rules tagged `wm-branch-{id}-direct` for this branch only (the other branches use line-level FORWARD rules between wm-wg0 and wm-tun{N})
- The branch's `-cidr` and `-dns` ipsets still exist and are referenced by mangle rules — direct-exit doesn't skip the filter/matching layer, just the tunneling layer

## Phase 8: Dynamic Changes (after Phase 7 passes)

**Do NOT reinstall or restart agents.** All changes are made via API while the system is running.

### 8a. Add New Lines
- Add 2 new direct lines: Direct-AD (A→D), Direct-AB2 (A→B)
- Create 1 Xray + 1 WG + 1 SOCKS5 device on each new line
- Wait for Agent to auto-sync config

### 8b. Verify Stability
- Existing SOCKS5/Xray ports must NOT have changed (compare to the snapshot taken before 8a — `ss -tlnp | grep wiremesh-agent` per entry node).
- All `wm-tun{id}` names from before 8a still exist on A; only the new ones were added.
- Existing tunnel handshakes on A are NOT reset to 0.
- **Sample-test, not full re-run.** Build a sampled matrix: one device per line from the original 16 (covering each line once) plus all 6 new devices = 13 entries.
  ```tsv
  <macbook_id>	MacBook-WG	wireguard	<split_id>	ifconfig.me=B,ip.me=C,icanhazip.com=D
  <iphone_id>	iPhone-WG	wireguard	<direct_id>	ifconfig.me=B,ip.me=B,icanhazip.com=B
  <ipad_id>	iPad-WG	wireguard	<relay_id>	ifconfig.me=C,ip.me=C,icanhazip.com=C
  <linux_id>	Linux-WG	wireguard	<reverse_id>	ifconfig.me=A,ip.me=A,icanhazip.com=A
  <laptop_id>	Laptop-WG	wireguard	<single_id>	ifconfig.me=B,ip.me=B,icanhazip.com=B
  <smart_wg_id>	Smart-WG	wireguard	<splitdirect_id>	ifconfig.me=B,ip.sb=C,ip.me=A,pconline=A
  <sharedrelay_id>	SharedRelay-WG	wireguard	<sharedrelay_id>	ifconfig.me=C,ip.me=B,icanhazip.com=D
  <new_ad_wg>	New-AD-WG	wireguard	<direct_ad_id>	ifconfig.me=D,ip.me=D,icanhazip.com=D
  <new_ad_xray>	New-AD-Xray	xray	<direct_ad_id>	ifconfig.me=D,ip.me=D,icanhazip.com=D
  <new_ad_socks>	New-AD-SOCKS5	socks5	<direct_ad_id>	ifconfig.me=D,ip.me=D,icanhazip.com=D
  <new_ab2_wg>	New-AB2-WG	wireguard	<direct_ab2_id>	ifconfig.me=B,ip.me=B,icanhazip.com=B
  <new_ab2_xray>	New-AB2-Xray	xray	<direct_ab2_id>	ifconfig.me=B,ip.me=B,icanhazip.com=B
  <new_ab2_socks>	New-AB2-SOCKS5	socks5	<direct_ab2_id>	ifconfig.me=B,ip.me=B,icanhazip.com=B
  ```
  Then run `lib/batch-test.sh /tmp/wm-matrix-8b.tsv`. The seven sampled rows cover every line topology (split / direct / relay / reverse / single-node / split-direct / shared-relay) and the six new rows cover the new lines completely. If a regression is line-shaped, one of these seven will catch it.

### 8c. Delete a Line
- Delete one of the new lines (e.g., Direct-AB2) via `DELETE /api/lines/{id}`
- Wait 30s for Agent sync
- Verify deleted line's tunnel was removed (`wm-tun{id}` gone from `ip link show` on A)
- Verify deleted line's iptables rules were cleaned (`iptables -nvL FORWARD | grep wm-line-{deleted_id}` returns empty)
- Re-run the 8b sampled matrix **with the three deleted-line rows removed** (`grep -v Direct-AB2` from the TSV) — confirms remaining devices still work after the topology change.

### 8d. Branch CRUD on existing line (regression guard)

Exercises the per-branch CRUD endpoints (`POST /api/lines/{id}/branches`, `PATCH /api/lines/{id}/branches/{branchId}`, `DELETE /api/lines/{id}/branches/{branchId}`). Three classes of regression to guard:

- **Tunnel rebuild churn**: editing branch X must not tear down branch Y's tunnels (handshake timestamps preserved). hopIndex re-numbering must keep the line dense from 0.
- **Precision of SSE notification scope**: a name-only PATCH must not notify nodes that have no role in the touched branch. A filter-only PATCH must not rebuild any tunnel.
- **No-op short-circuit**: PATCH with values identical to the current state must not bump `lines.updatedAt` / `lineBranches.updatedAt` and must not emit any SSE event.

Target line: **Split** (entry A; default→B, ip.me→C, icanhazip→D). All operations use `curl -b /tmp/wm-cookies.txt` against `$PLATFORM`.

**Before starting, snapshot baseline state on Server A:**
```bash
ssh root@A "wg show all latest-handshakes" > /tmp/wm-hs-base.txt
ssh root@A "wg show interfaces" > /tmp/wm-tuns-base.txt
curl -s -b /tmp/wm-cookies.txt $PLATFORM/api/lines/<split_line_id> > /tmp/wm-split-base.json
```

#### 8d.1. Add a non-default branch
```bash
curl -b /tmp/wm-cookies.txt -X POST $PLATFORM/api/lines/<split_line_id>/branches \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E-IPSB","isDefault":false,"nodeIds":[<D_id>],"filterIds":[<ip_sb_filter_id>]}'
```
Wait 30s. Verify on A:
- New tunnel `wm-tun{N}` exists where `{N}` is a new id (not present in `wm-tuns-base.txt`).
- Existing tunnels' handshake timestamps in `wg show all latest-handshakes` are within 5s of `wm-hs-base.txt` (i.e. unchanged or naturally advanced — NOT reset to 0).
- `GET /api/lines/<split_line_id>` returns 4 branches; `tunnels[*].hopIndex` is `[0, 1, 2, ..., N-1]` with no gaps.
- MacBook-WG: `curl --connect-timeout 10 -s https://api.ip.sb/ip` returns **D's IP**. Other matrix columns (ifconfig.me / ip.me / icanhazip.com) unchanged from Phase 7 expectations.

#### 8d.2. Edit branch nodeIds (replace exit)
Re-snapshot handshakes:
```bash
ssh root@A "wg show all latest-handshakes" > /tmp/wm-hs-8d2.txt
```
Find the branchId of the `ip.me`-bound branch (originally → C) from the GET response, then:
```bash
curl -b /tmp/wm-cookies.txt -X PATCH $PLATFORM/api/lines/<split_line_id>/branches/<ipme_branch_id> \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":[<D_id>]}'
```
Wait 30s. Verify:
- The old A→C tunnel for that branch is gone (`wg show interfaces` no longer lists it; the wm-tun{id} for that branch's old tunnel does not appear).
- A new A→D tunnel exists for that branch.
- **Default branch (A→B)** and **icanhazip branch (A→D, the original one)** handshakes in `/tmp/wm-hs-8d2.txt` are preserved (timestamps unchanged or naturally advanced).
- hopIndex still dense from 0 (re-fetch GET, eyeball `tunnels[*].hopIndex`).
- MacBook-WG: `curl https://ip.me` now returns **D's IP** (was C in Phase 7).

#### 8d.3. Edit branch filterIds only — must NOT rebuild tunnels
```bash
ssh root@A "wg show all latest-handshakes" > /tmp/wm-hs-8d3.txt
sleep 5  # let timestamps tick a bit
curl -b /tmp/wm-cookies.txt -X PATCH $PLATFORM/api/lines/<split_line_id>/branches/<icanhazip_branch_id> \
  -H "Content-Type: application/json" \
  -d '{"filterIds":[<icanhazip_filter_id>,<overseas_services_filter_id>]}'
```
Wait 15s. Verify:
- ALL tunnel handshake timestamps from `/tmp/wm-hs-8d3.txt` are unchanged or have naturally advanced (kernel keepalive). NONE reset to 0.
- Agent log on A in the last 30s: NO line matching `Creating tunnel|Destroying tunnel|wg-quick up|wg-quick down`. Only ipset / iptables update lines for the new filter binding.
- `ipset list` on A shows the new filter's domains/CIDRs in `wm-branch-{icanhazip_branch_id}-dns`/`-cidr`.

#### 8d.4. Edit branch name only — must NOT notify unrelated nodes
Snapshot agent log markers on B (whose role in Split is exit of the *default* branch — B is unrelated to the icanhazip branch we're about to rename):
```bash
ssh root@B "journalctl -u wiremesh-agent -n 1 --no-pager | tail -1" > /tmp/wm-B-log-mark.txt
curl -b /tmp/wm-cookies.txt -X PATCH $PLATFORM/api/lines/<split_line_id>/branches/<icanhazip_branch_id> \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E-Renamed"}'
sleep 15
ssh root@B "journalctl -u wiremesh-agent --since '20 seconds ago' --no-pager"
```
Verify:
- B's agent log in the last 20s shows NO new sync activity (no `[sync]`, no `Updated config version`, no tunnel/iptables/ipset changes). B is not in the icanhazip branch (default branch's exit), so it must not be notified.
- A's agent log in the same window MAY show a brief sync (entry is always notified) — that's fine.
- D's agent log MAY show activity (D is in the icanhazip branch).
- C's agent log MUST be silent (C was removed from ip.me branch in 8d.2 and is not in icanhazip branch).
- `GET /api/lines/<split_line_id>` shows the renamed branch.

#### 8d.5. Delete a non-default branch
```bash
ssh root@A "wg show all latest-handshakes" > /tmp/wm-hs-8d5.txt
curl -b /tmp/wm-cookies.txt -X DELETE $PLATFORM/api/lines/<split_line_id>/branches/<E2E_IPSB_branch_id>
```
Wait 30s. Verify:
- The `wm-tun{N}` for E2E-IPSB no longer appears in `ip link show` on A or D.
- Remaining branches' handshake timestamps unchanged from `/tmp/wm-hs-8d5.txt`.
- `GET /api/lines/<split_line_id>` returns 3 branches (E2E-IPSB gone). `tunnels[*].hopIndex` is `[0, 1, 2, ..., N-1]` — dense from 0 with NO gaps (this is the `normalizeLineTunnelHopIndexes` regression guard).
- MacBook-WG: `curl https://api.ip.sb/ip` no longer routes to D — falls through to default branch and returns **B's IP** (the filter binding was removed with the branch).

#### 8d.6. No-op PATCH — full short-circuit
Take precise pre-state snapshots:
```bash
ssh root@A "wg show all latest-handshakes" > /tmp/wm-hs-8d6.txt
LINE_UPDATED_AT=$(curl -s -b /tmp/wm-cookies.txt $PLATFORM/api/lines/<split_line_id> | jq -r .data.updatedAt)
DEFAULT_BRANCH_BEFORE=$(curl -s -b /tmp/wm-cookies.txt $PLATFORM/api/lines/<split_line_id> | jq '.data.branches[] | select(.isDefault==true)')
```
Issue a PATCH with values identical to current state (re-fetch then re-submit the same fields):
```bash
curl -b /tmp/wm-cookies.txt -X PATCH $PLATFORM/api/lines/<split_line_id>/branches/<default_branch_id> \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$(echo "$DEFAULT_BRANCH_BEFORE" | jq -r .name)\",\"isDefault\":true,\"nodeIds\":[<B_id>],\"filterIds\":[]}"
sleep 10
```
Verify:
- `lines.updatedAt` re-fetched is **identical** to `$LINE_UPDATED_AT` — DB write was short-circuited.
- The branch object re-fetched is **deep-equal** to `$DEFAULT_BRANCH_BEFORE` (including `updatedAt`).
- All tunnel handshake timestamps from `/tmp/wm-hs-8d6.txt` unchanged.
- Agent log on A in the last 15s: silent (no sync line). No SSE was emitted because `affectedNodeIds` was never reached.

#### 8d.7. Audit log spot-check
```bash
curl -s -b /tmp/wm-cookies.txt "$PLATFORM/api/audit-logs?targetType=line&targetId=<split_line_id>&pageSize=20"
```
Verify the log entries from 8d.1–8d.5 each include both `nodes=[...]` and `filters=[...]` in `detail`. This guards against the audit-detail regression where filterIds were silently dropped.

**Aggregate fail conditions (any match = a regression in this commit's branch CRUD code):**
- After 8d.2's PATCH: handshake timestamp on the *default branch's* tunnel reset to 0 → tunnel rebuild leaked across branches.
- After any operation: hopIndex gap (e.g. `[0, 1, 3]`) → `normalizeLineTunnelHopIndexes` regressed.
- 8d.3: any tunnel handshake reset → filter-only PATCH wrongly triggered topology rebuild.
- 8d.4: B's agent log shows sync activity → SSE notification scope regressed (over-broad).
- 8d.6: `lines.updatedAt` advanced or any agent log line appeared → no-op short-circuit regressed.
- 8d.7: any audit detail missing `filters=[...]` → audit log regressed.

### Expected Results for Dynamic Phase

| Device | Protocol | Line | Expected Exit IP |
|--------|----------|------|-----------------|
| New-AD-Xray | Xray | Direct-AD | D (47.84.231.26) |
| New-AD-WG | WG | Direct-AD | D (47.84.231.26) |
| New-AD-SOCKS5 | SOCKS5 | Direct-AD | D (47.84.231.26) |
| New-AB2-Xray | Xray | Direct-AB2 | B (47.236.3.88) |
| New-AB2-WG | WG | Direct-AB2 | B (47.236.3.88) |
| New-AB2-SOCKS5 | SOCKS5 | Direct-AB2 | B (47.236.3.88) |

### Stability Checks
- Original 16 devices: SOCKS5 proxy URLs must be identical before and after adding lines
- Tunnel handshake timestamps: existing tunnels must NOT reset to 0 after config change
- Agent logs: should NOT show "Destroying" for existing tunnels, only "Creating" for new ones

### 8e. DNS Rule Survival Across Source Sync (regression guard)

Guards against a previous-generation bug where SourceSyncer used iptables rule deletion by comment-prefix match (`strings.Contains`) and over-deleted the `-dns` rules when re-applying external `-cidr` rules, silently wiping domain-based matching. The current dual-ipset architecture should make this structurally impossible; this test asserts it stays that way.

Steps (run on Server A, SSH read-only + client-side Docker):
1. Baseline: `Smart-WG` curls `https://ip.me` → record exit IP = **A**
2. Baseline ipset refcount: `ipset list wm-branch-{branch3_id}-dns | grep References` → must be **≥ 1** (will be `2` when Smart-Xray is on the line, since both PREROUTING and Xray OUTPUT reference the ipset). Record the value — the regression check below requires it stays the same.
3. Trigger a fresh source sync. The `filter_sync_interval` setting defaults to **86400s (24h)** in production, so periodic ticks will not fire in a test window — you must force one. Two-step:
   ```bash
   curl -b /tmp/wm-cookies.txt -X PUT $PLATFORM/api/settings \
     -H 'Content-Type: application/json' -d '{"filter_sync_interval":"60"}'
   # Then create a probe device on Split-Direct to trigger SourceSyncer.Sync
   # (which always does an immediate fetchAndApply for every source — that counts as a sync).
   curl -b /tmp/wm-cookies.txt -X POST $PLATFORM/api/devices \
     -H 'Content-Type: application/json' \
     -d "{\"name\":\"E2E-Probe-8e\",\"protocol\":\"wireguard\",\"lineId\":<split_direct_line_id>}"
   ```
   Wait for the log line: `[sync] Rebuilt wm-branch-{branch3_id}-cidr: N entries (static=... external=...)` — typically appears within 5–10s of the probe device creation. Delete the probe afterwards.
4. Re-check `Smart-WG` curls `https://ip.me` → exit IP **must still be A** (if it drifted to B, the `-dns` rule was clobbered)
5. Re-check ipset refcount → unchanged from baseline (i.e. still `≥ 1`, dropping to 0 is the regression)
6. `iptables -t mangle -S PREROUTING | grep -c wm-branch-{branch3_id}` → still exactly **2** (cidr + dns). More than 2 means inline CIDR rules regressed; less than 2 means a rule was lost.

Fail conditions (any of these = regression):
- Smart-WG's ip.me exit drifts from A to B after a filter source sync
- `wm-branch-{id}-dns` ipset `References` drops to 0
- Total PREROUTING rule count for the branch exceeds 2
- Agent logs show `[iptables] Removing: ... wm-branch-{id}-dns` from a SourceSyncer code path

### 8f. SourceUrl Domain + Reload Timing (regression guard)

Guards two related bugs fixed in commit `bea60f8`:
- **Bug A** (DNS namespace): `Manager.Sync` used to call `UpdateRules` (i.e. `SetRules`) every reload, wiping the matcher's entire domain map — including `sourceUrl` rules merged in by `SourceSyncer`. The window from "reload triggered" to "next fetchAndApply completes" left external domains with no ipset target. Combined with client DNS TTL, a single reload could route a client through the wrong branch for minutes to hours.
- **Bug C** (concurrent rebuild): Eager `rebuildBranchCidrSet` in `UpdateSources` raced with the `fetchAndApply` goroutine on a fixed `.tmp` ipset name. Errors: `ipset add ... tmp ... set does not exist` and `ipset swap ... second set does not exist`.

The fix splits the matcher into static (Manager-owned) + external per-filter-id (SourceSyncer-owned) namespaces, and adds a per-branch mutex around `rebuildBranchCidrSet`. This regression guard exercises both at once.

The platform ships a permanent fixture endpoint for this test:
`/api/agent/test-fixtures/domains` returns 3 reserved test domains. It lives under `/api/agent/*` so it bypasses auth (matching real Agent fetches). See `src/app/api/agent/test-fixtures/domains/route.ts`.

Steps:
1. Create a sourceUrl filter pointing at the fixture, bound to Split-Direct branch-10:
   ```bash
   curl -b /tmp/wm-cookies.txt -X POST $PLATFORM/api/filters \
     -H "Content-Type: application/json" \
     -d '{"name":"E2E-DomainSync","sourceUrl":"https://3456--main--apang--kuaifan.coder.dootask.com/api/agent/test-fixtures/domains","mode":"whitelist","branchIds":[<branch10_id>]}'
   ```
2. Wait 30s. Verify on Server A:
   ```
   journalctl -u wiremesh-agent | grep "Updated filter=<filter_id>"
   ```
   Should show `[dns] Updated filter=<filter_id> domain rules: 3 entries`.
3. Trigger a reload by adding a probe device:
   ```bash
   curl -b /tmp/wm-cookies.txt -X POST $PLATFORM/api/devices \
     -H "Content-Type: application/json" \
     -d '{"name":"E2E-Probe","protocol":"wireguard","lineId":<split_direct_line_id>}'
   ```
4. Wait 25s. Re-grep agent log on A. Expect this exact pattern:
   - `[dns] Updated static domain rules: N entries` — Manager.Sync only touched static
   - (later) `[dns] Updated filter=<filter_id> domain rules: 3 entries` — SourceSyncer re-fetch confirmed, **count is still 3, never 0**
5. Grep for ipset race patterns (must be empty):
   ```
   journalctl -u wiremesh-agent --since "60 seconds ago" | grep -E \
     'add .* tmp .* failed|Sets cannot be swapped|initial rebuild .* failed'
   ```
6. Cleanup: delete the probe device and the E2E-DomainSync filter. The fixture endpoint stays.

Fail conditions:
- After reload, the `Updated filter=<id>` count drops to 0 at any point (Bug A regressed — static path is wiping external map)
- Any ipset race log appears during the reload (Bug C regressed — per-branch mutex broken)
- Reload window exceeds 30s before `Updated filter=<id>` reappears with count 3

### 8g. Agent Hot-Upgrade Regression

Guards SOCKS5 listener bind race in commit `d2b2020`. The SOCKS5 manager always closes and rebinds listeners on every config Sync (to pick up credential changes). Without `SO_REUSEADDR` + `SO_REUSEPORT`, the kernel hasn't yet released the old socket and `net.Listen` fails with `EADDRINUSE`, leaving the entry node with no SOCKS5 listeners until manual restart.

The upgrade flow is the most reliable way to trigger this — fresh process gets multiple rapid config applies during startup. This phase exercises the full path.

Steps:
1. Snapshot SOCKS5 ports on each entry node before upgrade:
   ```bash
   ssh root@A "ss -tlnp | grep wiremesh-agent" > /tmp/wm-socks5-pre.txt
   ssh root@B "ss -tlnp | grep wiremesh-agent" >> /tmp/wm-socks5-pre.txt
   ```
2. Bump agent VERSION (only the version string changes — code identical):
   ```bash
   cd agent
   VERSION="$(cat ../public/agent/agent-version.txt | awk -F. '{print $1"."$2"."$3+1}')"
   for ARCH in amd64 arm64; do
     CGO_ENABLED=0 GOOS=linux GOARCH=$ARCH go build -ldflags "-X main.Version=$VERSION" -o wiremesh-agent .
     tar czf ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz wiremesh-agent
     sha256sum ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz > ../public/agent/wiremesh-agent-linux-${ARCH}.tar.gz.sha256
     rm wiremesh-agent
   done
   echo -n "$VERSION" > ../public/agent/agent-version.txt
   ```
3. Trigger batch upgrade for all 4 nodes:
   ```bash
   curl -b /tmp/wm-cookies.txt -X POST $PLATFORM/api/nodes/batch-upgrade \
     -H "Content-Type: application/json" \
     -d '{"nodeIds":[1,2,3,4],"type":"agent"}'
   ```
4. Poll until all nodes report new version (check `GET /api/nodes`, look at `agentVersion`). Typical: 30–60s.
5. Wait additional 20s for routing to settle, then verify SOCKS5 listeners on entry nodes:
   ```bash
   ssh root@A "ss -tlnp | grep wiremesh-agent"
   ssh root@B "ss -tlnp | grep wiremesh-agent"
   ```
   Expected: each SOCKS5 port from the pre-upgrade snapshot still listening, owned by the new agent PID. Compare counts and ports — must match.
6. Re-run a representative subset of Docker tests (1 WG + 1 Xray + 1 SOCKS5 + Smart-WG) to confirm traffic still flows.
7. Inspect agent log for bind failures:
   ```bash
   ssh root@A "journalctl -u wiremesh-agent --since '5 minutes ago' | grep 'bind: address already in use'"
   ```
   Must be empty.

Fail conditions:
- Any SOCKS5 port from pre-snapshot is missing in post-snapshot (`SO_REUSEADDR`/`SO_REUSEPORT` regressed)
- `bind: address already in use` appears in agent log
- Representative device traffic test fails after upgrade

Side effect: every successful e2e run leaves the agent at a slightly newer version. That's intentional — it doubles as a "the upgrade path works" sanity check before any real release.

## Failure Protocol

1. Record actual vs expected
2. SSH to gather diagnostics (read-only)
3. Identify root cause
4. Fix in code, rebuild Agent, restart from Phase 1

**Never manually fix server configurations.**