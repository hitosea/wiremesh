# Certificate Mode (auto/certd/manual) + Auto-Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit "cert exists ⇒ manual" inference with a persisted three-state `xrayCertMode` (`auto` | `certd` | `manual`), and make auto-mode certificates renew before expiry instead of silently expiring after 90 days.

**Architecture:** Add a persisted `xray_cert_mode` column. The UI reads/writes it explicitly (no more inference). The platform sends `certMode` to the Agent in the Xray config. The Agent's auto-cert gate switches from "cert is empty" to "mode == auto", which un-blocks the already-written 30-day renewal check; a daily ticker re-runs the renewal check so long-lived nodes renew without a config change. The certd webhook marks the nodes it serves as `certd` so the Agent stops its built-in ACME for them.

**Tech Stack:** Next.js 16 (App Router) + drizzle-orm/better-sqlite3, Go agent (`golang.org/x/crypto/acme/autocert`), next-intl, vitest, Go `testing`.

---

## Background / Root Cause (read before starting)

Two distinct bugs share one root cause: there is **no persisted cert-mode field**. Today:

- **UI "auto → manual" flip:** `src/app/(dashboard)/nodes/[id]/page.tsx:180-183` infers `manual` whenever `xrayTlsCert` is non-empty.
- **No renewal:** `agent/xray/acme.go:18-20` gates `AutoCert` on `cfg.TlsCert == ""`. The platform always echoes the stored cert back (`src/app/api/agent/config/route.ts:443`), so after the first issue the gate is permanently closed and the 30-day check at `acme.go:48` becomes dead code. There is also no periodic trigger (`agent/agent/agent.go:69` only has a status-report ticker).

This plan makes mode an explicit, persisted value used by both layers.

## File Structure

**Modify:**
- `src/lib/db/schema.ts` — add `xrayCertMode` column
- `drizzle/0013_add_xray_cert_mode.sql` — **Create** migration
- `drizzle/meta/_journal.json` — register migration
- `agent/api/config_types.go` — add `CertMode` to `XrayConfig`
- `agent/xray/acme.go` — gate on mode, expiry check from cfg, mutate cfg on issue
- `agent/xray/acme_test.go` — **Create** Go tests
- `agent/agent/agent.go` — store last Xray cfg, add daily renewal ticker
- `src/app/api/agent/config/route.ts` — emit `certMode`
- `src/app/api/nodes/route.ts` — POST accepts/sets `xrayCertMode`
- `src/app/api/nodes/[id]/route.ts` — PUT accepts/sets `xrayCertMode`; GET returns it
- `src/lib/certd-webhook.ts` — set mode `certd` on served nodes
- `__tests__/lib/certd-webhook.test.ts` — assert mode set
- `src/app/(dashboard)/nodes/[id]/page.tsx` — read/write mode, 3-state Select
- `src/app/(dashboard)/nodes/new/page.tsx` — send mode
- `messages/en.json`, `messages/zh-CN.json` — new keys

**Decisions baked in:**
- Column default `'manual'` (safe for non-ws-tls and for existing nodes that already hold a cert — they won't suddenly re-ACME).
- Migration backfills existing **ws-tls nodes whose cert is NULL** to `'auto'` so they still get their first cert (preserves current behavior). Existing ws-tls nodes that already have a cert stay `'manual'`; if one was actually auto-issued, the admin flips it to `auto` to enable renewal (call this out in release notes).
- certd webhook sets served nodes to `'certd'` (certd now owns renewal; Agent stops built-in ACME).
- All three modes are user-selectable in the UI.

---

### Task 1: Add `xrayCertMode` schema column + migration

**Files:**
- Modify: `src/lib/db/schema.ts:48` (after `xrayTlsKey`)
- Create: `drizzle/0013_add_xray_cert_mode.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Add the column to the drizzle schema**

In `src/lib/db/schema.ts`, immediately after the `xrayTlsKey` line (currently line 48):

```typescript
  xrayTlsKey: text("xray_tls_key"),
  xrayCertMode: text("xray_cert_mode").notNull().default("manual"),
```

- [ ] **Step 2: Create the migration SQL**

Create `drizzle/0013_add_xray_cert_mode.sql` with exactly:

```sql
ALTER TABLE `nodes` ADD `xray_cert_mode` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE `nodes` SET `xray_cert_mode` = 'auto' WHERE `xray_transport` = 'ws-tls' AND `xray_tls_cert` IS NULL;
```

- [ ] **Step 3: Register the migration in the journal**

In `drizzle/meta/_journal.json`, append this object to the `entries` array (after the `idx: 12` entry):

```json
    {
      "idx": 13,
      "version": "6",
      "when": 1780099200000,
      "tag": "0013_add_xray_cert_mode",
      "breakpoints": true
    }
```

(Add a comma after the previous entry's closing brace.)

- [ ] **Step 4: Apply & verify the migration**

Migrations run automatically on first DB access (`src/lib/db/index.ts:28`). Apply against the dev DB and inspect the column:

Run:
```bash
cd /home/coder/workspaces/wiremesh
node -e "require('./src/lib/db'); " 2>/dev/null; \
sqlite3 ./data/wiremesh.db "PRAGMA table_info(nodes);" | grep xray_cert_mode
```
Expected: a row containing `xray_cert_mode|text|1|'manual'` (notnull=1, default 'manual'). If `node -e` cannot resolve TS imports, instead start the dev server once (`npm run dev`), hit any page, stop it, then run the `sqlite3` line.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0013_add_xray_cert_mode.sql drizzle/meta/_journal.json
git commit -m "feat(db): add xray_cert_mode column (auto/certd/manual)"
```

---

### Task 2: Add `CertMode` to the Agent Xray config type

**Files:**
- Modify: `agent/api/config_types.go:77` (after `TlsKey`)

- [ ] **Step 1: Add the field**

In `agent/api/config_types.go`, inside the `XrayConfig` struct, after the `TlsKey` line:

```go
	TlsKey             string            `json:"tlsKey,omitempty"`
	CertMode           string            `json:"certMode,omitempty"` // "auto" | "certd" | "manual"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/coder/workspaces/wiremesh/agent && go build ./...`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add agent/api/config_types.go
git commit -m "feat(agent): add CertMode to XrayConfig"
```

---

### Task 3: Gate auto-cert on mode + renew from cfg expiry (Agent ACME)

This is the core renewal fix. `needsAutocert` now keys on `CertMode == "auto"`. `localCertValid(domain)` is replaced by `certValid(cfg)`, which reads expiry from the platform-supplied PEM (`cfg.TlsCert`) and only falls back to the on-disk file — this avoids a spurious re-issue on a fresh disk where the file isn't written yet. On (re)issue, `AutoCert` mutates `cfg.TlsCert`/`cfg.TlsKey` in place so the rest of `Sync` writes the fresh cert and restarts Xray.

**Files:**
- Modify: `agent/xray/acme.go:18-51`, `:122-129`
- Test: `agent/xray/acme_test.go` (Create)

- [ ] **Step 1: Write the failing Go test**

Create `agent/xray/acme_test.go`:

```go
package xray

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/wiremesh/agent/api"
)

// makeCertPEM builds a self-signed cert PEM valid until notAfter.
func makeCertPEM(t *testing.T, notAfter time.Time) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "vpn.example.com"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("createcert: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

func TestNeedsAutocert(t *testing.T) {
	cases := []struct {
		name string
		cfg  *api.XrayConfig
		want bool
	}{
		{"auto+domain", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "d", CertMode: "auto"}, true},
		{"manual", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "d", CertMode: "manual"}, false},
		{"certd", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "d", CertMode: "certd"}, false},
		{"auto-but-reality", &api.XrayConfig{Transport: "reality", TlsDomain: "d", CertMode: "auto"}, false},
		{"auto-no-domain", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "", CertMode: "auto"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := needsAutocert(c.cfg); got != c.want {
				t.Fatalf("needsAutocert=%v want %v", got, c.want)
			}
		})
	}
}

func TestCertValid_FromCfg(t *testing.T) {
	farFuture := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: makeCertPEM(t, time.Now().Add(60*24*time.Hour))}
	if !certValid(farFuture) {
		t.Fatal("expected cert valid for >30 days to be considered valid")
	}
	nearExpiry := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: makeCertPEM(t, time.Now().Add(10*24*time.Hour))}
	if certValid(nearExpiry) {
		t.Fatal("expected cert within 30 days of expiry to be considered invalid (needs renewal)")
	}
	empty := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: ""}
	if certValid(empty) {
		t.Fatal("expected empty cert (and no disk file) to be invalid")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/coder/workspaces/wiremesh/agent && go test ./xray/ -run 'TestNeedsAutocert|TestCertValid_FromCfg' -v`
Expected: compile error — `certValid` undefined, and `needsAutocert` still references `TlsCert`. (Build failure counts as the failing state.)

- [ ] **Step 3: Update the gate and expiry check in `acme.go`**

In `agent/xray/acme.go`, replace lines 18-51 (the `needsAutocert`, `localCertValid`, and the top of `AutoCert` through the validity check) with:

```go
func needsAutocert(cfg *api.XrayConfig) bool {
	return cfg.Transport == "ws-tls" && cfg.TlsDomain != "" && cfg.CertMode == "auto"
}

// certValid reports whether the effective certificate for the domain is valid
// for at least 30 more days. It prefers the platform-supplied PEM (cfg.TlsCert)
// and falls back to the on-disk file, so a fresh disk (no file yet) does not
// trigger a needless re-issue when the platform already holds a valid cert.
func certValid(cfg *api.XrayConfig) bool {
	var data []byte
	if cfg.TlsCert != "" {
		data = []byte(cfg.TlsCert)
	} else {
		certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, cfg.TlsDomain)
		b, err := os.ReadFile(certPath)
		if err != nil {
			return false
		}
		data = b
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

	if certValid(cfg) {
		log.Printf("[acme] Cert for %s still valid (>30d), skipping", domain)
		return nil
	}
```

(The body below — ACME challenge, PEM conversion, file writes — stays unchanged through the local save.)

- [ ] **Step 4: Mutate cfg in place after a successful issue**

In `agent/xray/acme.go`, in the issue path, after the local save log line (`log.Printf("[acme] Certificate saved for %s", domain)`, currently line 122) and before the `client.UploadCert(...)` call, insert:

```go
	// Make the freshly issued cert the effective one for the rest of this Sync
	// pass (writeCertFiles + GenerateConfig + restart), and for the next call.
	cfg.TlsCert = string(certPEM)
	cfg.TlsKey = string(keyPEM)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/coder/workspaces/wiremesh/agent && go test ./xray/ -run 'TestNeedsAutocert|TestCertValid_FromCfg' -v`
Expected: PASS (all subtests ok).

- [ ] **Step 6: Verify the whole agent still builds & tests pass**

Run: `cd /home/coder/workspaces/wiremesh/agent && go build ./... && go test ./...`
Expected: build clean; existing xray/config/api tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add agent/xray/acme.go agent/xray/acme_test.go
git commit -m "fix(agent): gate auto-cert on CertMode and renew before expiry"
```

---

### Task 4: Daily renewal ticker in the Agent loop

`Sync` only runs on startup and on SSE config changes, so a long-lived node could pass its 30-day window untouched. Add a daily ticker that re-runs the cert check against the last-applied Xray config.

**Files:**
- Modify: `agent/xray/manager.go` (add `RenewCertIfNeeded`)
- Modify: `agent/agent/agent.go:20-32` (struct), `:178-198` (store cfg), `:68-87` (ticker)

- [ ] **Step 1: Add `RenewCertIfNeeded` to the xray package**

In `agent/xray/manager.go`, after the `Sync` function (after line 72, the closing brace of `Sync`), add:

```go
// RenewCertIfNeeded re-runs the auto-cert flow for ws-tls auto-mode nodes.
// Safe to call periodically: it no-ops unless the cert is within 30 days of
// expiry, in which case it re-issues, re-uploads, and restarts Xray via Sync.
func RenewCertIfNeeded(cfg *api.XrayConfig, client *api.Client) error {
	if cfg == nil || !cfg.Enabled {
		return nil
	}
	if !needsAutocert(cfg) {
		return nil
	}
	if certValid(cfg) {
		return nil
	}
	log.Printf("[xray] Cert for %s approaching expiry, renewing", cfg.TlsDomain)
	return Sync(cfg, client)
}
```

- [ ] **Step 2: Store the last-applied Xray config on the Agent**

In `agent/agent/agent.go`, add a field to the `Agent` struct (after `lastVersion string`, line 28):

```go
	lastVersion    string
	lastXray       *api.XrayConfig
```

Then in `pullAndApplyConfigForce`, immediately after `a.lastVersion = cfgData.Version` (line 228), add:

```go
	a.lastVersion = cfgData.Version
	a.lastXray = cfgData.Xray
```

- [ ] **Step 3: Add the daily renewal ticker to `Run`**

In `agent/agent/agent.go`, after the `reportTicker` block (lines 68-70), add:

```go
	// 4. Start status reporting ticker
	reportTicker := time.NewTicker(time.Duration(a.cfg.ReportInterval) * time.Second)
	defer reportTicker.Stop()

	// 4b. Start daily cert-renewal ticker (auto-mode ws-tls nodes only)
	certTicker := time.NewTicker(24 * time.Hour)
	defer certTicker.Stop()
```

Then add a case to the `select` in the event loop (after the `case <-reportTicker.C:` block, line 84-85):

```go
		case <-reportTicker.C:
			a.reportStatus()
		case <-certTicker.C:
			if err := xray.RenewCertIfNeeded(a.lastXray, a.client); err != nil {
				log.Printf("[agent] Cert renewal check failed: %v", err)
			}
```

- [ ] **Step 4: Verify build & tests**

Run: `cd /home/coder/workspaces/wiremesh/agent && go build ./... && go test ./...`
Expected: build clean, tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/agent/agent.go agent/xray/manager.go
git commit -m "feat(agent): daily auto-cert renewal ticker"
```

---

### Task 5: Send `certMode` to the Agent in the config endpoint

`authenticateAgent` already does `db.select()` (all columns), so `node.xrayCertMode` is available without changing the query. Only the ws-tls branch needs to emit it.

**Files:**
- Modify: `src/app/api/agent/config/route.ts:436-447`

- [ ] **Step 1: Add `certMode` to the ws-tls xrayConfig object**

In `src/app/api/agent/config/route.ts`, in the `xrayTransport === "ws-tls"` branch, add `certMode` to the `xrayConfig` object (after the `tlsKey,` line, line 444):

```typescript
        tlsCert: node.xrayTlsCert ?? "",
        tlsKey,
        certMode: node.xrayCertMode ?? "manual",
```

- [ ] **Step 2: Verify type-check**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no error referencing `route.ts` / `certMode` / `xrayCertMode`. (Pre-existing unrelated errors, if any, are acceptable — confirm none mention this file.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat(api): send certMode to agent in xray config"
```

---

### Task 6: POST /api/nodes accepts and persists `xrayCertMode`

**Files:**
- Modify: `src/app/api/nodes/route.ts:154-256`

- [ ] **Step 1: Destructure and resolve the mode**

In `src/app/api/nodes/route.ts`, add `xrayCertMode` to the destructure (after `xrayTlsKey,`, line 167):

```typescript
    xrayTlsCert,
    xrayTlsKey,
    xrayCertMode,
```

Then after the `normalizedTlsDomain` line (line 176), add:

```typescript
  const normalizedTlsDomain = String(xrayTlsDomain ?? "").trim();
  const VALID_CERT_MODES = ["auto", "certd", "manual"] as const;
  const certMode =
    transport === "ws-tls" && VALID_CERT_MODES.includes(xrayCertMode)
      ? xrayCertMode
      : transport === "ws-tls"
        ? "auto"
        : "manual";
```

- [ ] **Step 2: Persist it on insert**

In the `.values({...})` object, after the `xrayTlsKey:` line (line 250-251), add:

```typescript
      xrayTlsKey:
        transport === "ws-tls" && xrayTlsKey ? encrypt(xrayTlsKey) : null,
      xrayCertMode: certMode,
```

- [ ] **Step 3: Verify type-check**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "nodes/route" || echo "no errors in nodes/route"`
Expected: `no errors in nodes/route`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "feat(api): persist xrayCertMode on node create"
```

---

### Task 7: PUT /api/nodes/[id] accepts and persists `xrayCertMode`; GET returns it

**Files:**
- Modify: `src/app/api/nodes/[id]/route.ts:38` (GET select), `:164-176` (PUT)

- [ ] **Step 1: Return the mode from GET**

In `src/app/api/nodes/[id]/route.ts`, in the GET `.select({...})`, after `xrayTlsKey: nodes.xrayTlsKey,` (line 39), add:

```typescript
      xrayTlsKey: nodes.xrayTlsKey,
      xrayCertMode: nodes.xrayCertMode,
```

- [ ] **Step 2: Accept and validate the mode in PUT**

In the PUT handler, in the "Handle WS+TLS fields" block (after the `xrayTlsKey` handling, line 174-176), add:

```typescript
  if (body.xrayTlsKey !== undefined) {
    updateData.xrayTlsKey = body.xrayTlsKey ? encrypt(body.xrayTlsKey) : null;
  }
  if (body.xrayCertMode !== undefined) {
    const valid = ["auto", "certd", "manual"];
    if (!valid.includes(body.xrayCertMode)) {
      return error("VALIDATION_ERROR", "validation.invalidCertMode");
    }
    updateData.xrayCertMode = body.xrayCertMode;
  }
```

- [ ] **Step 3: Add the validation message key**

Add `"invalidCertMode"` under the `validation` namespace in both message files. In `messages/en.json` (validation block):

```json
    "invalidCertMode": "Invalid certificate mode",
```

In `messages/zh-CN.json`:

```json
    "invalidCertMode": "证书模式无效",
```

(Place each next to the existing `wsTlsDomainRequired` key in the `validation` object.)

- [ ] **Step 4: Verify type-check**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "nodes/\[id\]/route" || echo "no errors in [id]/route"`
Expected: `no errors in [id]/route`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/nodes/[id]/route.ts messages/en.json messages/zh-CN.json
git commit -m "feat(api): persist and return xrayCertMode on node update"
```

---

### Task 8: certd webhook marks served nodes as `certd`

**Files:**
- Modify: `src/lib/certd-webhook.ts:85-93`
- Test: `__tests__/lib/certd-webhook.test.ts`

- [ ] **Step 1: Write the failing test assertion**

In `__tests__/lib/certd-webhook.test.ts`, add `xrayCertMode` to the `NodeRow` type (after `xrayTlsKey: string | null;`, line 59):

```typescript
  xrayTlsKey: string | null;
  xrayCertMode: string | null;
  updatedAt: string | null;
```

Add `xrayCertMode: null,` (or `"auto"`) to every `dbState.rows` literal in the file (each row object — there are several in the `applyCertToMatchingNodes` describe block). Then in the test `"updates only nodes with ws-tls + matching domain"`, after the existing assertions on row 0, add:

```typescript
    expect(dbState.rows[0].xrayCertMode).toBe("certd");
```

And add a focused test at the end of the `applyCertToMatchingNodes` describe block:

```typescript
  it("flips served nodes to certd mode", () => {
    dbState.rows = [
      { id: 1, xrayTransport: "ws-tls", xrayTlsDomain: "test.example.com", xrayTlsCert: null, xrayTlsKey: null, xrayCertMode: "auto", updatedAt: null },
    ];
    applyCertToMatchingNodes(payload);
    expect(dbState.rows[0].xrayCertMode).toBe("certd");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/coder/workspaces/wiremesh && npx vitest run __tests__/lib/certd-webhook.test.ts`
Expected: FAIL — `expected undefined to be "certd"`.

- [ ] **Step 3: Set the mode in the webhook update**

In `src/lib/certd-webhook.ts`, in `applyCertToMatchingNodes`, add `xrayCertMode: "certd",` to the `.set({...})` object (after `xrayTlsKey: encryptedKey,`, line 88):

```typescript
          .set({
            xrayTlsCert: payload.crt,
            xrayTlsKey: encryptedKey,
            xrayCertMode: "certd",
            updatedAt: sql`(datetime('now'))`,
          })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/coder/workspaces/wiremesh && npx vitest run __tests__/lib/certd-webhook.test.ts`
Expected: PASS (all tests in file green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/certd-webhook.ts __tests__/lib/certd-webhook.test.ts
git commit -m "feat(certd): mark webhook-served nodes as certd cert mode"
```

---

### Task 9: i18n — add `certd` mode label + hints

**Files:**
- Modify: `messages/en.json` (nodes namespace, near line 161), `messages/zh-CN.json` (near line 161)

- [ ] **Step 1: Add keys to `messages/en.json`**

In the `nodes` namespace, next to the existing `tlsCertModeManual` / `tlsCertAutoHint` keys, add:

```json
    "tlsCertModeCertd": "External (certd)",
    "tlsCertCertdHint": "An external certd service pushes and renews the certificate via webhook. The agent will not request its own certificate.",
```

- [ ] **Step 2: Add keys to `messages/zh-CN.json`**

```json
    "tlsCertModeCertd": "外部 certd",
    "tlsCertCertdHint": "由外部 certd 服务通过 webhook 推送并自动续期证书，Agent 不会自行申请证书。",
```

- [ ] **Step 3: Verify JSON is valid**

Run: `cd /home/coder/workspaces/wiremesh && node -e "require('./messages/en.json'); require('./messages/zh-CN.json'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "i18n: add certd cert mode labels"
```

---

### Task 10: Node detail page — read/write mode, drop inference, 3-state Select

**Files:**
- Modify: `src/app/(dashboard)/nodes/[id]/page.tsx:50` (type), `:97` (state type), `:177-186` (load), `:218-223` (save), `:491-503` (Select), `:500-502` (hints)

- [ ] **Step 1: Widen the state and type to three modes**

In `src/app/(dashboard)/nodes/[id]/page.tsx`, change the `NodeDetail` type field (line 50 area) — add after `xrayTlsKey: string | null;`:

```typescript
  xrayTlsKey: string | null;
  xrayCertMode: "auto" | "certd" | "manual" | null;
```

Change the state declaration (line 97):

```typescript
  const [tlsCertMode, setTlsCertMode] = useState<"auto" | "certd" | "manual">("auto");
```

- [ ] **Step 2: Replace the inference with the persisted value on load**

In the node-load `.then(...)` block, replace the current cert-mode inference (lines 180-186):

```typescript
        if (n.xrayTlsCert) {
          setTlsCertMode("manual");
          setTlsCert(n.xrayTlsCert);
        }
        if (n.xrayTlsKey) {
          setTlsKey(n.xrayTlsKey);
        }
```

with:

```typescript
        setTlsCertMode(n.xrayCertMode ?? "manual");
        if (n.xrayTlsCert) setTlsCert(n.xrayTlsCert);
        if (n.xrayTlsKey) setTlsKey(n.xrayTlsKey);
```

- [ ] **Step 3: Always send the mode on save; send cert/key only when manual**

In `handleSave`, in the `xrayTransport === "ws-tls"` block (lines 218-224), replace:

```typescript
      if (xrayTransport === "ws-tls") {
        body.xrayTlsDomain = tlsDomain;
        if (tlsCertMode === "manual") {
          body.xrayTlsCert = tlsCert;
          body.xrayTlsKey = tlsKey;
        }
      }
```

with:

```typescript
      if (xrayTransport === "ws-tls") {
        body.xrayTlsDomain = tlsDomain;
        body.xrayCertMode = tlsCertMode;
        if (tlsCertMode === "manual") {
          body.xrayTlsCert = tlsCert;
          body.xrayTlsKey = tlsKey;
        }
      }
```

- [ ] **Step 4: Add the third option + hint to the Select**

Replace the Select + hint block (lines 491-503):

```tsx
                <div className="space-y-2">
                  <Label>{ts("tlsCertMode")}</Label>
                  <Select value={tlsCertMode} onValueChange={(v: string) => setTlsCertMode(v as "auto" | "certd" | "manual")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{ts("tlsCertModeAuto")}</SelectItem>
                      <SelectItem value="certd">{ts("tlsCertModeCertd")}</SelectItem>
                      <SelectItem value="manual">{ts("tlsCertModeManual")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {tlsCertMode === "auto" && (
                    <p className="text-xs text-muted-foreground">{ts("tlsCertAutoHint")}</p>
                  )}
                  {tlsCertMode === "certd" && (
                    <p className="text-xs text-muted-foreground">{ts("tlsCertCertdHint")}</p>
                  )}
                </div>
```

(The `{tlsCertMode === "manual" && (<>...cert/key textareas...</>)}` block below stays as-is — it already shows the textareas only for manual.)

- [ ] **Step 5: Verify type-check**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "nodes/\[id\]/page" || echo "no errors in [id]/page"`
Expected: `no errors in [id]/page`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/nodes/[id]/page.tsx"
git commit -m "feat(ui): persist cert mode on node detail, add certd option"
```

---

### Task 11: New node page — send `xrayCertMode`

**Files:**
- Modify: `src/app/(dashboard)/nodes/new/page.tsx:47` (state type), `:82-88` (submit body)

- [ ] **Step 1: Widen the state type**

In `src/app/(dashboard)/nodes/new/page.tsx`, change line 47:

```typescript
  const [tlsCertMode, setTlsCertMode] = useState<"auto" | "certd" | "manual">("auto");
```

- [ ] **Step 2: Send the mode in the create body**

In `handleSubmit`, in the `else` (ws-tls) branch (lines 82-88), replace:

```typescript
      } else {
        body.xrayTlsDomain = tlsDomain.trim();
        if (tlsCertMode === "manual") {
          body.xrayTlsCert = tlsCert;
          body.xrayTlsKey = tlsKey;
        }
      }
```

with:

```typescript
      } else {
        body.xrayTlsDomain = tlsDomain.trim();
        body.xrayCertMode = tlsCertMode;
        if (tlsCertMode === "manual") {
          body.xrayTlsCert = tlsCert;
          body.xrayTlsKey = tlsKey;
        }
      }
```

- [ ] **Step 3: Mirror the 3-state Select on the new-node form**

Find the cert-mode `Select` in this file (same structure as the detail page, with `auto`/`manual` items) and add the `certd` `SelectItem` + the `certd` hint exactly as in Task 10 Step 4. If the new-node form has no cert-mode Select yet (only domain + conditional manual fields), add the same `<div className="space-y-2">…</div>` block from Task 10 Step 4 directly above the manual cert/key fields.

Run: `grep -n "tlsCertMode\|SelectItem value=\"manual\"" "src/app/(dashboard)/nodes/new/page.tsx"`
Use the output to locate the Select; apply the same three-option markup.

- [ ] **Step 4: Verify type-check**

Run: `cd /home/coder/workspaces/wiremesh && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "nodes/new/page" || echo "no errors in new/page"`
Expected: `no errors in new/page`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/nodes/new/page.tsx"
git commit -m "feat(ui): send cert mode on node create, add certd option"
```

---

### Task 12: Full-stack verification

- [ ] **Step 1: All unit tests + builds**

Run:
```bash
cd /home/coder/workspaces/wiremesh && npm test
cd /home/coder/workspaces/wiremesh/agent && go build ./... && go test ./...
cd /home/coder/workspaces/wiremesh && npm run lint
```
Expected: vitest green, Go build clean + tests PASS, lint clean (or only pre-existing warnings unrelated to these files).

- [ ] **Step 2: Manual UI round-trip (dev server)**

Per project memory, run the platform with `npm run dev` (never docker compose). Then:
1. Create a ws-tls node with mode **Auto** → reopen it → it still shows **Auto** (not flipped to Manual). This is the original bug, now fixed.
2. Switch a node to **Manual**, paste cert/key, save, reopen → shows **Manual** with the cert.
3. Switch to **External (certd)** → save → reopen → shows **External (certd)**, cert/key textareas hidden.

Capture screenshots to `.playwright-mcp/` (gitignored) if using Playwright.

- [ ] **Step 3: DB spot-check**

Run: `sqlite3 ./data/wiremesh.db "SELECT id, xray_transport, xray_cert_mode, (xray_tls_cert IS NOT NULL) AS has_cert FROM nodes;"`
Expected: each ws-tls node shows the mode you selected; non-ws-tls nodes show `manual`.

- [ ] **Step 4: Agent renewal logic check (optional, e2e)**

If exercising the agent end-to-end, use the `e2e-test` skill. Confirm in agent logs that an auto-mode node with a cert >30 days from expiry logs `Cert for … still valid (>30d), skipping`, and that a node whose mode is `manual`/`certd` never logs an ACME request.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: verify cert mode + renewal end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** three-state field (Task 1, 2), DB migration + backfill (Task 1), UI read/write/no-inference (Task 10, 11), agent gate change (Task 3), agent renewal trigger (Task 4), certd → certd mode (Task 8), config delivery to agent (Task 5), create/update APIs (Task 6, 7), i18n (Task 9). All covered.
- **Type/name consistency:** schema property `xrayCertMode` ↔ column `xray_cert_mode` ↔ Go `CertMode`/json `certMode` ↔ UI state `tlsCertMode` (local) sending body key `xrayCertMode`. Modes string set `["auto","certd","manual"]` identical across API validators, UI Select, and Go gate (Go only acts on `"auto"`).
- **Migration safety:** existing ws-tls + cert present stay `manual` (no surprise re-ACME); ws-tls + no cert → `auto` (first issue preserved). Document the "flip an already-auto-issued node to Auto to enable renewal" caveat in release notes.
- **Renewal correctness:** `certValid` reads `cfg.TlsCert` first (platform echoes it), so a fresh disk doesn't force re-issue; on renewal `AutoCert` mutates `cfg` so `writeCertFiles`+restart pick up the new cert (`manager.go:55-58` restarts on `certsChanged`).
