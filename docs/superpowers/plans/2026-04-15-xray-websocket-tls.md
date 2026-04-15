# Xray WebSocket+TLS Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebSocket+TLS as an alternative Xray transport alongside REALITY, selectable per node, with automatic or manual TLS certificate management.

**Architecture:** The change touches three layers: data schema (4 new columns), platform config generation (transport-aware Xray/device configs), and Agent (dynamic streamSettings + cert file management + ACME auto-provisioning). REALITY remains the default; WS+TLS is opt-in per node.

**Tech Stack:** Next.js (platform), Go (agent), SQLite (DB), Xray-core (proxy), `golang.org/x/crypto/acme` (ACME client)

---

### Task 1: Database Schema — Add WS+TLS Fields to Nodes Table

**Files:**
- Modify: `src/lib/db/schema.ts:30-55`

- [ ] **Step 1: Add 4 new columns to the nodes table**

In `src/lib/db/schema.ts`, add after the `xrayConfig` column (line 44):

```typescript
xrayWsPath: text("xray_ws_path"),
xrayTlsDomain: text("xray_tls_domain"),
xrayTlsCert: text("xray_tls_cert"),
xrayTlsKey: text("xray_tls_key"),
```

- [ ] **Step 2: Verify the dev server starts without errors**

Run: `curl -s http://localhost:3456/api/nodes | head -20`

SQLite with Drizzle auto-creates missing columns on access. Verify the API still responds. If the dev server uses strict schema, check for a migration step (this project uses Drizzle push mode — no migrations needed).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(schema): add xrayWsPath, xrayTlsDomain, xrayTlsCert, xrayTlsKey columns"
```

---

### Task 2: Node Creation — Generate WS Path on Create

**Files:**
- Modify: `src/app/api/nodes/route.ts:206-235`

- [ ] **Step 1: Import crypto for random path generation**

At the top of `src/app/api/nodes/route.ts`, add `randomBytes` to the existing crypto imports or add:

```typescript
import { randomBytes } from "crypto";
```

- [ ] **Step 2: Generate xrayWsPath during node creation**

In the `POST` handler, before the `db.insert(nodes).values({...})` call (around line 220), add:

```typescript
const xrayWsPath = "/" + randomBytes(4).toString("hex");
```

Then add `xrayWsPath` to the `.values({...})` object (after `xrayConfig`):

```typescript
xrayWsPath,
```

- [ ] **Step 3: Test node creation**

Create a node via API and verify the response includes the new field:

```bash
curl -s -k -b /tmp/cookies "$P/api/nodes" -X POST -H "Content-Type: application/json" \
  -d '{"name":"test-ws","ip":"1.2.3.4","externalInterface":"eth0"}' | python3 -c "
import sys,json; d=json.load(sys.stdin); print('wsPath:', d['data'].get('xrayWsPath', 'MISSING'))
"
```

Expected: `wsPath: /xxxxxxxx` (8 hex chars)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "feat(nodes): generate xrayWsPath on node creation"
```

---

### Task 3: Node Update API — Handle WS+TLS Fields

**Files:**
- Modify: `src/app/api/nodes/[id]/route.ts:60-140`

- [ ] **Step 1: Accept new fields in the PUT handler**

In the `PUT` handler body parsing section, add handling for the new fields. After the existing `realityDest` handling block (around line 136), add:

```typescript
if (body.xrayTransport !== undefined) {
  updateData.xrayTransport = body.xrayTransport;
}
if (body.xrayTlsDomain !== undefined) {
  updateData.xrayTlsDomain = body.xrayTlsDomain || null;
}
if (body.xrayTlsCert !== undefined) {
  updateData.xrayTlsCert = body.xrayTlsCert || null;
}
if (body.xrayTlsKey !== undefined) {
  updateData.xrayTlsKey = body.xrayTlsKey ? encrypt(body.xrayTlsKey) : null;
}
```

- [ ] **Step 2: Add validation — WS+TLS requires domain**

Before the `db.update` call, add validation:

```typescript
if (updateData.xrayTransport === "ws-tls") {
  const domain = body.xrayTlsDomain ?? existing.xrayTlsDomain;
  if (!domain) {
    return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
  }
}
```

Where `existing` is the current node fetched at the start of the PUT handler.

- [ ] **Step 3: Ensure xrayWsPath exists when switching to WS+TLS**

If a node was created before this feature (no wsPath), generate one on update:

```typescript
if (updateData.xrayTransport === "ws-tls" && !existing.xrayWsPath) {
  updateData.xrayWsPath = "/" + randomBytes(4).toString("hex");
}
```

Add `import { randomBytes } from "crypto"` if not already imported.

- [ ] **Step 4: Add the `xrayWsPath` field to the existing node SELECT query**

Make sure the existing node query at the top of PUT selects the new fields. Find the `db.select(...)` for the existing node and add `xrayWsPath`, `xrayTlsDomain`, `xrayTransport` to the selected columns.

- [ ] **Step 5: Test updating a node to WS+TLS**

```bash
# Should fail without domain
curl -s -k -b /tmp/cookies "$P/api/nodes/1" -X PUT -H "Content-Type: application/json" \
  -d '{"xrayTransport":"ws-tls"}'
# Expected: validation error

# Should succeed with domain
curl -s -k -b /tmp/cookies "$P/api/nodes/1" -X PUT -H "Content-Type: application/json" \
  -d '{"xrayTransport":"ws-tls","xrayTlsDomain":"vpn.example.com"}'
# Expected: success
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/nodes/[id]/route.ts
git commit -m "feat(nodes): handle xrayTransport and TLS fields in node update"
```

---

### Task 4: Agent Config API — Transport-Aware Xray Config Generation

**Files:**
- Modify: `src/app/api/agent/config/route.ts:290-386`

- [ ] **Step 1: Read transport mode from node**

The `node` object already has all columns. After the `node.xrayConfig` parsing block (line 290), add transport detection:

```typescript
const xrayTransport = node.xrayTransport === "ws-tls" ? "ws-tls" : "reality";
```

- [ ] **Step 2: Build xrayConfig with transport field**

Replace the final `xrayConfig = { ... }` block (lines 375-386) with transport-aware logic:

```typescript
if (xrayTransport === "ws-tls") {
  let tlsKey = "";
  if (node.xrayTlsKey) {
    try { tlsKey = decrypt(node.xrayTlsKey); } catch { tlsKey = ""; }
  }
  xrayConfig = {
    enabled: true,
    protocol: "vless",
    port: xrayBasePort,
    transport: "ws-tls",
    wsPath: node.xrayWsPath ?? "/default",
    tlsDomain: node.xrayTlsDomain ?? "",
    tlsCert: node.xrayTlsCert ?? "",
    tlsKey,
    routes: xrayRoutes,
    dnsProxy: hasDomainRules && node.wgAddress ? node.wgAddress.split("/")[0] : "",
  };
} else {
  xrayConfig = {
    enabled: true,
    protocol: "vless",
    port: xrayBasePort,
    transport: "reality",
    realityPrivateKey,
    realityShortId: realitySettings.realityShortId ?? "",
    realityDest: realitySettings.realityDest ?? "www.microsoft.com:443",
    realityServerNames: [realitySettings.realityServerName ?? "www.microsoft.com"],
    routes: xrayRoutes,
    dnsProxy: hasDomainRules && node.wgAddress ? node.wgAddress.split("/")[0] : "",
  };
}
```

- [ ] **Step 3: Test by fetching agent config for a WS+TLS node**

Set a node to ws-tls mode, then fetch its agent config and verify the transport field:

```bash
curl -s -k -H "X-Node-ID: 1" -H "X-Agent-Token: <token>" "$P/api/agent/config" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); x=d.get('data',{}).get('xray',{}); print('transport:', x.get('transport'), 'wsPath:', x.get('wsPath'))"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat(agent-config): generate transport-aware xray config (reality vs ws-tls)"
```

---

### Task 5: Device Client Config — WS+TLS Client Config Generation

**Files:**
- Modify: `src/app/api/devices/[id]/config/route.ts:92-189`

- [ ] **Step 1: Read transport mode from entry node**

After the existing `nodeXrayConfig` query (around line 101), also fetch transport fields:

```typescript
const nodeTransport = db
  .select({ xrayTransport: nodes.xrayTransport, xrayTlsDomain: nodes.xrayTlsDomain, xrayWsPath: nodes.xrayWsPath })
  .from(nodes)
  .where(eq(nodes.id, entryNodeRow.nodeId))
  .get();
const isWsTls = nodeTransport?.xrayTransport === "ws-tls";
```

- [ ] **Step 2: Generate WS+TLS client config when applicable**

Replace the hardcoded `streamSettings` and share link generation (lines 126-186) with transport-aware logic:

```typescript
let streamSettings: Record<string, unknown>;
let shareLink: string;

if (isWsTls) {
  const domain = nodeTransport!.xrayTlsDomain!;
  const wsPath = nodeTransport!.xrayWsPath ?? "/ws";

  streamSettings = {
    network: "ws",
    security: "tls",
    wsSettings: { path: wsPath, headers: { Host: domain } },
    tlsSettings: { serverName: domain },
  };

  const vlessParams = new URLSearchParams({
    encryption: "none",
    security: "tls",
    type: "ws",
    host: domain,
    path: wsPath,
    sni: domain,
  });
  shareLink = `vless://${device.xrayUuid}@${domain}:${xrayPort}?${vlessParams.toString()}#${encodeURIComponent(device.name)}`;
} else {
  streamSettings = {
    network: "tcp",
    security: "reality",
    realitySettings: {
      serverName: realityServerName,
      fingerprint: "chrome",
      publicKey: realityPublicKey,
      shortId: realityShortId,
    },
  };

  const vlessParams = new URLSearchParams({
    encryption: "none",
    flow: "xtls-rprx-vision",
    security: "reality",
    sni: realityServerName,
    fp: "chrome",
    pbk: realityPublicKey,
    sid: realityShortId,
    type: "tcp",
  });
  shareLink = `vless://${device.xrayUuid}@${endpoint}:${xrayPort}?${vlessParams.toString()}#${encodeURIComponent(device.name)}`;
}
```

Update the Xray JSON config to use the dynamic `streamSettings`, and conditionally include `flow` only for REALITY:

```typescript
const userConfig: Record<string, unknown> = {
  id: device.xrayUuid,
  encryption: "none",
};
if (!isWsTls) {
  userConfig.flow = "xtls-rprx-vision";
}
```

- [ ] **Step 3: Test device config for a WS+TLS node's device**

```bash
curl -s -k -b /tmp/cookies "$P/api/devices/<id>/config" | python3 -c "
import sys,json; d=json.load(sys.stdin)['data']
print('format:', d['format'])
if 'shareLink' in d: print('link:', d['shareLink'][:80])
"
```

Verify the share link contains `security=tls&type=ws&path=` and uses the domain as endpoint.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/devices/[id]/config/route.ts
git commit -m "feat(device-config): generate ws-tls client config with domain endpoint"
```

---

### Task 6: Agent Go Types — Add Transport Fields to XrayConfig

**Files:**
- Modify: `agent/api/config_types.go:57-85`

- [ ] **Step 1: Add transport and WS+TLS fields to XrayConfig struct**

In `agent/api/config_types.go`, add new fields to the `XrayConfig` struct after `DNSProxy`:

```go
type XrayConfig struct {
	Enabled            bool              `json:"enabled"`
	Protocol           string            `json:"protocol"`
	Port               int               `json:"port"`
	Transport          string            `json:"transport,omitempty"`          // "reality" or "ws-tls"
	RealityPrivateKey  string            `json:"realityPrivateKey,omitempty"`
	RealityShortId     string            `json:"realityShortId,omitempty"`
	RealityDest        string            `json:"realityDest,omitempty"`
	RealityServerNames []string          `json:"realityServerNames,omitempty"`
	WsPath             string            `json:"wsPath,omitempty"`             // WebSocket path
	TlsDomain          string            `json:"tlsDomain,omitempty"`          // TLS domain
	TlsCert            string            `json:"tlsCert,omitempty"`            // PEM cert content
	TlsKey             string            `json:"tlsKey,omitempty"`             // PEM key content
	Routes             []XrayLineRoute   `json:"routes"`
	DNSProxy           string            `json:"dnsProxy,omitempty"`
}
```

- [ ] **Step 2: Verify agent compiles**

```bash
cd agent && go build ./... && echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add agent/api/config_types.go
git commit -m "feat(agent-types): add Transport, WsPath, TlsDomain, TlsCert, TlsKey to XrayConfig"
```

---

### Task 7: Agent Xray Config Builder — Dynamic streamSettings

**Files:**
- Modify: `agent/xray/config.go:14-152`

- [ ] **Step 1: Make streamSettings dynamic based on transport**

In the `GenerateConfig` function, replace the hardcoded `streamSettings` block inside the inbound loop (around line 57) with:

```go
var streamSettings map[string]interface{}
if cfg.Transport == "ws-tls" {
	streamSettings = map[string]interface{}{
		"network":  "ws",
		"security": "tls",
		"wsSettings": map[string]interface{}{
			"path": cfg.WsPath,
		},
		"tlsSettings": map[string]interface{}{
			"certificates": []map[string]interface{}{
				{
					"certificateFile": fmt.Sprintf("/etc/wiremesh/xray/%s.crt", cfg.TlsDomain),
					"keyFile":         fmt.Sprintf("/etc/wiremesh/xray/%s.key", cfg.TlsDomain),
				},
			},
			"serverName": cfg.TlsDomain,
		},
	}
} else {
	streamSettings = map[string]interface{}{
		"network":  "tcp",
		"security": "reality",
		"realitySettings": map[string]interface{}{
			"show":        false,
			"dest":        cfg.RealityDest,
			"xver":        0,
			"serverNames": cfg.RealityServerNames,
			"privateKey":  cfg.RealityPrivateKey,
			"shortIds":    []string{cfg.RealityShortId},
		},
	}
}
```

Use `streamSettings` in the inbound map instead of the inline definition.

- [ ] **Step 2: Remove flow for WS+TLS clients**

The `flow: "xtls-rprx-vision"` field in the client map is REALITY-specific. Make it conditional:

```go
client := map[string]interface{}{
	"id":    uuid,
	"email": uuid,
	"level": 0,
}
if cfg.Transport != "ws-tls" {
	client["flow"] = "xtls-rprx-vision"
}
```

- [ ] **Step 3: Verify agent compiles**

```bash
cd agent && go build ./... && echo "OK"
```

- [ ] **Step 4: Commit**

```bash
git add agent/xray/config.go
git commit -m "feat(agent-xray): dynamic streamSettings for reality vs ws-tls"
```

---

### Task 8: Agent Certificate File Management

**Files:**
- Modify: `agent/xray/manager.go:20-57`

- [ ] **Step 1: Add cert file writing logic to the Sync function**

In `manager.go`, add a helper function for writing cert files:

```go
func writeCertFiles(cfg *api.XrayConfig) error {
	if cfg.Transport != "ws-tls" || cfg.TlsDomain == "" || cfg.TlsCert == "" {
		return nil
	}

	certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, cfg.TlsDomain)
	keyPath := fmt.Sprintf("%s/%s.key", XrayConfigDir, cfg.TlsDomain)

	if err := os.MkdirAll(XrayConfigDir, 0755); err != nil {
		return fmt.Errorf("create xray config dir: %w", err)
	}

	certChanged := writeIfChanged(certPath, cfg.TlsCert, 0644)
	keyChanged := writeIfChanged(keyPath, cfg.TlsKey, 0600)

	if certChanged || keyChanged {
		log.Printf("[xray] TLS cert files updated for %s", cfg.TlsDomain)
	}
	return nil
}

func writeIfChanged(path, content string, perm os.FileMode) bool {
	existing, _ := os.ReadFile(path)
	if string(existing) == content {
		return false
	}
	os.WriteFile(path, []byte(content), perm)
	return true
}
```

- [ ] **Step 2: Call writeCertFiles before config generation in Sync**

In the `Sync` function, add before the `GenerateConfig` call:

```go
if err := writeCertFiles(cfg); err != nil {
	return fmt.Errorf("write cert files: %w", err)
}
```

- [ ] **Step 3: Verify agent compiles**

```bash
cd agent && go build ./... && echo "OK"
```

- [ ] **Step 4: Commit**

```bash
git add agent/xray/manager.go
git commit -m "feat(agent-xray): write TLS cert files before config generation"
```

---

### Task 9: Agent ACME Auto-Certificate — New File

**Files:**
- Create: `agent/xray/acme.go`
- Modify: `agent/go.mod` (add dependency)

- [ ] **Step 1: Add golang.org/x/crypto dependency**

```bash
cd agent && go get golang.org/x/crypto && echo "OK"
```

- [ ] **Step 2: Create agent/xray/acme.go**

```go
package xray

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"

	"github.com/wiremesh/agent/api"
)

func needsAutocert(cfg *api.XrayConfig) bool {
	return cfg.Transport == "ws-tls" && cfg.TlsDomain != "" && cfg.TlsCert == ""
}

func localCertValid(domain string) bool {
	certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, domain)
	data, err := os.ReadFile(certPath)
	if err != nil {
		return false
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}
	return time.Now().Add(30 * 24 * time.Hour).Before(cert.NotAfter)
}

func AutoCert(cfg *api.XrayConfig, client *api.Client) error {
	if !needsAutocert(cfg) {
		return nil
	}

	domain := cfg.TlsDomain
	certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, domain)
	keyPath := fmt.Sprintf("%s/%s.key", XrayConfigDir, domain)

	if localCertValid(domain) {
		log.Printf("[acme] Local cert for %s is still valid, skipping", domain)
		return nil
	}

	log.Printf("[acme] Requesting certificate for %s via HTTP-01", domain)

	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domain),
		Cache:      autocert.DirCache(XrayConfigDir + "/acme"),
	}

	// Start temporary HTTP server on port 80 for ACME challenge
	srv := &http.Server{
		Addr:    ":80",
		Handler: m.HTTPHandler(nil),
	}

	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[acme] HTTP-01 server error: %v", err)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	defer srv.Shutdown(context.Background())

	// Trigger certificate issuance
	cert, err := m.GetCertificate(&tls.ClientHelloInfo{ServerName: domain})
	if err != nil {
		return fmt.Errorf("acme GetCertificate: %w (is port 80 accessible and domain %s pointing to this server?)", err, domain)
	}

	// Extract PEM from the tls.Certificate
	var certPEM, keyPEM []byte
	for _, der := range cert.Certificate {
		certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}

	privKey, ok := cert.PrivateKey.(*ecdsa.PrivateKey)
	if !ok {
		// Try RSA
		privDER, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
		if err != nil {
			return fmt.Errorf("marshal private key: %w", err)
		}
		keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})
	} else {
		privDER, err := x509.MarshalECPrivateKey(privKey)
		if err != nil {
			return fmt.Errorf("marshal EC private key: %w", err)
		}
		keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privDER})
	}

	// Write files locally
	os.MkdirAll(XrayConfigDir, 0755)
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return fmt.Errorf("write cert file: %w", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		return fmt.Errorf("write key file: %w", err)
	}
	log.Printf("[acme] Certificate saved for %s", domain)

	// Upload to platform
	if err := client.UploadCert(domain, string(certPEM), string(keyPEM)); err != nil {
		log.Printf("[acme] Failed to upload cert to platform: %v (cert is saved locally)", err)
	} else {
		log.Printf("[acme] Certificate uploaded to platform for %s", domain)
	}

	return nil
}
```

Note: This uses `autocert.Manager` which handles the full ACME flow including HTTP-01 challenge. The `crypto/tls` import will be needed — add `"crypto/tls"` to the imports.

- [ ] **Step 3: Add UploadCert method to agent API client**

In `agent/api/client.go` (or the file containing the API client), add:

```go
func (c *Client) UploadCert(domain, cert, key string) error {
	body := map[string]string{
		"domain": domain,
		"cert":   cert,
		"key":    key,
	}
	return c.post("/api/agent/cert", body)
}
```

If `post` doesn't exist as a generic method, model it on the existing `ReportStatus` or `ReportError` methods.

- [ ] **Step 4: Call AutoCert in the Sync function (manager.go)**

In `manager.go`'s `Sync` function, add before `writeCertFiles`:

```go
if err := AutoCert(cfg, client); err != nil {
	log.Printf("[xray] Auto-cert failed: %v", err)
	// Don't return — if local cert exists, continue with it
}
```

The `Sync` function signature needs to accept the API client. Update it from `Sync(cfg *api.XrayConfig)` to `Sync(cfg *api.XrayConfig, client *api.Client)` and update the call site in `agent/agent/agent.go`.

- [ ] **Step 5: Verify agent compiles**

```bash
cd agent && go build ./... && echo "OK"
```

- [ ] **Step 6: Commit**

```bash
git add agent/xray/acme.go agent/api/client.go agent/xray/manager.go agent/agent/agent.go agent/go.mod agent/go.sum
git commit -m "feat(agent-acme): auto-provision TLS certificates via ACME HTTP-01"
```

---

### Task 10: Platform API — Certificate Upload Endpoint

**Files:**
- Create: `src/app/api/agent/cert/route.ts`

- [ ] **Step 1: Create the cert upload API**

Create `src/app/api/agent/cert/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { authenticateAgent } from "@/lib/agent-auth";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const node = authenticateAgent(request);
  if (!node) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid Agent Token" } },
      { status: 401 }
    );
  }

  const body = await request.json();
  const { domain, cert, key } = body;

  if (!domain || !cert || !key) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "domain, cert, key required" } },
      { status: 400 }
    );
  }

  if (node.xrayTlsDomain !== domain) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "domain mismatch" } },
      { status: 400 }
    );
  }

  db.update(nodes)
    .set({
      xrayTlsCert: cert,
      xrayTlsKey: encrypt(key),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(nodes.id, node.id))
    .run();

  return Response.json({ data: { message: "Certificate stored" } });
}
```

- [ ] **Step 2: Verify the endpoint responds**

```bash
curl -s -k -X POST "$P/api/agent/cert" -H "Content-Type: application/json" \
  -H "X-Node-ID: 1" -H "X-Agent-Token: invalid" -d '{}' | head -50
```

Expected: 401 Unauthorized

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/cert/route.ts
git commit -m "feat(api): add POST /api/agent/cert for agent certificate upload"
```

---

### Task 11: Node Settings UI — Transport Selection

**Files:**
- Modify: `src/app/(dashboard)/nodes/[id]/page.tsx:82-325`
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add i18n translation keys**

In `messages/zh-CN.json`, in the `nodes` section, add:

```json
"xrayTransport": "传输方式",
"xrayTransportReality": "REALITY",
"xrayTransportWsTls": "WebSocket + TLS",
"tlsDomain": "TLS 域名",
"tlsDomainHint": "域名必须已解析到当前服务器 IP",
"tlsCertMode": "证书管理",
"tlsCertModeAuto": "自动申请",
"tlsCertModeManual": "手动上传",
"tlsCertAutoHint": "域名必须已解析到当前服务器，且 80 端口可被外部访问",
"tlsCert": "TLS 证书",
"tlsCertHint": "粘贴 PEM 格式证书内容",
"tlsKey": "TLS 私钥",
"tlsKeyHint": "粘贴 PEM 格式私钥内容",
"wsPath": "WebSocket 路径",
"wsPathHint": "系统自动生成，不可编辑"
```

Add equivalent English translations in `messages/en.json`.

- [ ] **Step 2: Add state variables for WS+TLS fields**

In the node edit page component, add state for the new fields (around line 90):

```typescript
const [xrayTransport, setXrayTransport] = useState("reality");
const [tlsDomain, setTlsDomain] = useState("");
const [tlsCertMode, setTlsCertMode] = useState<"auto" | "manual">("auto");
const [tlsCert, setTlsCert] = useState("");
const [tlsKey, setTlsKey] = useState("");
const [wsPath, setWsPath] = useState("");
```

Initialize from API response in the existing data-loading effect:

```typescript
setXrayTransport(n.xrayTransport || "reality");
setTlsDomain(n.xrayTlsDomain || "");
setWsPath(n.xrayWsPath || "");
if (n.xrayTlsCert) {
  setTlsCertMode("manual");
  setTlsCert(n.xrayTlsCert);
}
```

- [ ] **Step 3: Add transport selector UI**

In the Xray settings section (around line 282), add a transport selector before the existing Reality fields:

```tsx
<div className="space-y-2">
  <Label>{tn("xrayTransport")}</Label>
  <Select value={xrayTransport} onValueChange={setXrayTransport}>
    <SelectTrigger><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="reality">{tn("xrayTransportReality")}</SelectItem>
      <SelectItem value="ws-tls">{tn("xrayTransportWsTls")}</SelectItem>
    </SelectContent>
  </Select>
</div>
```

Wrap the existing Reality fields (realityDest, publicKey, shortId) in `{xrayTransport === "reality" && (...)}`.

Add WS+TLS fields in `{xrayTransport === "ws-tls" && (...)}`:

```tsx
{xrayTransport === "ws-tls" && (
  <>
    <div className="space-y-2">
      <Label htmlFor="tlsDomain">{tn("tlsDomain")}</Label>
      <Input id="tlsDomain" value={tlsDomain} onChange={(e) => setTlsDomain(e.target.value)} placeholder="vpn.example.com" />
      <p className="text-xs text-muted-foreground">{tn("tlsDomainHint")}</p>
    </div>
    <div className="space-y-2">
      <Label>{tn("tlsCertMode")}</Label>
      <Select value={tlsCertMode} onValueChange={(v) => setTlsCertMode(v as "auto" | "manual")}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{tn("tlsCertModeAuto")}</SelectItem>
          <SelectItem value="manual">{tn("tlsCertModeManual")}</SelectItem>
        </SelectContent>
      </Select>
      {tlsCertMode === "auto" && (
        <p className="text-xs text-muted-foreground">{tn("tlsCertAutoHint")}</p>
      )}
    </div>
    {tlsCertMode === "manual" && (
      <>
        <div className="space-y-2">
          <Label htmlFor="tlsCert">{tn("tlsCert")}</Label>
          <Textarea id="tlsCert" value={tlsCert} onChange={(e) => setTlsCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" rows={4} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">{tn("tlsCertHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tlsKey">{tn("tlsKey")}</Label>
          <Textarea id="tlsKey" value={tlsKey} onChange={(e) => setTlsKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" rows={4} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">{tn("tlsKeyHint")}</p>
        </div>
      </>
    )}
    {wsPath && (
      <div className="space-y-2">
        <Label>{tn("wsPath")}</Label>
        <code className="block text-xs bg-muted px-3 py-2 rounded">{wsPath}</code>
        <p className="text-xs text-muted-foreground">{tn("wsPathHint")}</p>
      </div>
    )}
  </>
)}
```

- [ ] **Step 4: Include new fields in the save request body**

In the save handler (around line 124), add the new fields:

```typescript
if (xrayTransport === "ws-tls") {
  body.xrayTransport = "ws-tls";
  body.xrayTlsDomain = tlsDomain;
  if (tlsCertMode === "manual") {
    body.xrayTlsCert = tlsCert;
    body.xrayTlsKey = tlsKey;
  }
} else {
  body.xrayTransport = "reality";
}
```

- [ ] **Step 5: Ensure required imports exist**

Check that `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, and `Textarea` are imported from the UI component library. Add missing imports.

- [ ] **Step 6: Test in browser**

1. Open a node edit page
2. Switch transport to "WebSocket + TLS"
3. Verify Reality fields hide and TLS fields appear
4. Fill in a domain, select "手动上传", paste dummy cert/key
5. Save and verify no errors
6. Reload the page and verify fields persist

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/nodes/\[id\]/page.tsx messages/zh-CN.json messages/en.json
git commit -m "feat(ui): add transport selection and WS+TLS fields to node settings"
```

---

### Task 12: Node List UI — Show Transport Type

**Files:**
- Modify: Node list page (the page that shows all nodes)

- [ ] **Step 1: Add transport indicator to node list**

In the nodes list page, find where `Xray/TCP` or similar is shown (the `portsXray` translation key). Update the display to show the transport type:

If `node.xrayTransport === "ws-tls"`, show `Xray/WS` instead of `Xray/TCP`.

- [ ] **Step 2: Update translation keys if needed**

Update `portsXray` or add a conditional display in the UI.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): show transport type in node list"
```

---

### Task 13: Integration Test — End-to-End Verification

- [ ] **Step 1: Verify REALITY mode still works unchanged**

Create a node with default settings (REALITY), create a device, fetch agent config and device config. Verify all REALITY fields are present and WS+TLS fields are absent.

- [ ] **Step 2: Verify WS+TLS mode config generation**

Update the node to `xrayTransport: "ws-tls"` with a domain. Fetch agent config and verify:
- `transport` = `"ws-tls"`
- `wsPath` is present
- `tlsDomain` matches
- REALITY fields are absent

- [ ] **Step 3: Verify device config for WS+TLS node**

Fetch device config and verify:
- Share link uses domain (not IP) as endpoint
- Share link contains `security=tls&type=ws`
- Xray JSON has `wsSettings` and `tlsSettings`
- No `flow` field in the client user config

- [ ] **Step 4: Verify cert upload API**

Call `POST /api/agent/cert` with valid agent auth and dummy cert data. Verify the node's `xrayTlsCert` is updated.

- [ ] **Step 5: Commit any test fixes**

```bash
git add -A
git commit -m "test: verify reality and ws-tls config generation end-to-end"
```
