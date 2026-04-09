# Xray Device Online Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add online/offline status tracking for Xray devices, matching the existing WireGuard device status experience.

**Architecture:** Enable Xray's built-in Stats module with UserOnline policy. Agent collects online users via `xray api getallonlineusers` CLI command (same pattern as `wg show` for WireGuard). Online UUIDs are reported alongside WG handshakes. Platform updates `lastHandshake` for matching Xray devices, reusing the existing 10-minute threshold logic.

**Tech Stack:** Go (Agent), Next.js/TypeScript (Platform), Xray Stats API (CLI), SQLite (Drizzle ORM)

**Spec:** `docs/superpowers/specs/2026-04-09-xray-device-online-status-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `agent/api/status.go` | Modify | Add `XrayOnlineUsers` field to `StatusReport` |
| `agent/xray/config.go` | Modify | Add stats/api/policy modules, dokodemo-door inbound, API routing rule, client email+level fields |
| `agent/xray/config_test.go` | Create | Test config generation includes stats, API inbound, email fields |
| `agent/collector/collector.go` | Modify | Add `collectXrayOnlineUsers()` function, call it from `Collect()` |
| `agent/collector/collector_test.go` | Modify | Add test for `parseXrayOnlineUsers()` output parsing |
| `src/app/api/agent/status/route.ts` | Modify | Process `xray_online_users` array, update matching devices' `lastHandshake` |
| `src/lib/device-status.ts` | Modify | Remove Xray "-" special case |
| `src/app/(dashboard)/devices/page.tsx` | Modify | Remove "-" status display special case |

---

### Task 1: Add `XrayOnlineUsers` field to StatusReport

**Files:**
- Modify: `agent/api/status.go:3-8`

- [ ] **Step 1: Add the field**

In `agent/api/status.go`, add the `XrayOnlineUsers` field to `StatusReport`:

```go
type StatusReport struct {
	IsOnline        bool              `json:"is_online"`
	Latency         *int              `json:"latency,omitempty"`
	Transfers       []TransferReport  `json:"transfers,omitempty"`
	Handshakes      []HandshakeReport `json:"handshakes,omitempty"`
	XrayOnlineUsers []string          `json:"xray_online_users,omitempty"`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd agent && go build ./...`
Expected: Success, no errors.

- [ ] **Step 3: Commit**

```bash
git add agent/api/status.go
git commit -m "feat(agent): add XrayOnlineUsers field to StatusReport"
```

---

### Task 2: Add stats/api/policy and email fields to Xray config generation

**Files:**
- Modify: `agent/xray/config.go`
- Create: `agent/xray/config_test.go`

- [ ] **Step 1: Write the failing test**

Create `agent/xray/config_test.go`:

```go
package xray

import (
	"encoding/json"
	"testing"

	"github.com/wiremesh/agent/api"
)

func TestGenerateConfig_StatsAndAPI(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled:            true,
		Protocol:           "vless",
		RealityPrivateKey:  "test-private-key",
		RealityShortId:     "abcd1234",
		RealityDest:        "www.example.com:443",
		RealityServerNames: []string{"www.example.com"},
		Routes: []api.XrayLineRoute{
			{
				LineID: 1,
				UUIDs:  []string{"uuid-aaa", "uuid-bbb"},
				Port:   41443,
				Mark:   100,
			},
		},
	}

	data, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	// stats must exist
	if _, ok := result["stats"]; !ok {
		t.Error("Expected 'stats' section in config")
	}

	// api section
	apiSection, ok := result["api"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected 'api' section in config")
	}
	if apiSection["tag"] != "api" {
		t.Errorf("Expected api tag 'api', got %v", apiSection["tag"])
	}

	// policy section with statsUserOnline
	policySection, ok := result["policy"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected 'policy' section in config")
	}
	levels := policySection["levels"].(map[string]interface{})
	level0 := levels["0"].(map[string]interface{})
	if level0["statsUserOnline"] != true {
		t.Errorf("Expected statsUserOnline=true, got %v", level0["statsUserOnline"])
	}

	// Check dokodemo-door inbound exists
	inbounds := result["inbounds"].([]interface{})
	var foundAPIInbound bool
	for _, ib := range inbounds {
		ibMap := ib.(map[string]interface{})
		if ibMap["tag"] == "api-in" {
			foundAPIInbound = true
			if ibMap["listen"] != "127.0.0.1" {
				t.Errorf("API inbound should listen on 127.0.0.1, got %v", ibMap["listen"])
			}
			if ibMap["port"] != float64(41380) {
				t.Errorf("API inbound should use port 41380, got %v", ibMap["port"])
			}
			if ibMap["protocol"] != "dokodemo-door" {
				t.Errorf("API inbound should use dokodemo-door, got %v", ibMap["protocol"])
			}
		}
	}
	if !foundAPIInbound {
		t.Error("Expected dokodemo-door API inbound with tag 'api-in'")
	}

	// Check routing has api rule first
	routing := result["routing"].(map[string]interface{})
	rules := routing["rules"].([]interface{})
	firstRule := rules[0].(map[string]interface{})
	if firstRule["outboundTag"] != "api" {
		t.Errorf("First routing rule should target 'api', got %v", firstRule["outboundTag"])
	}
}

func TestGenerateConfig_ClientEmailAndLevel(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled:            true,
		Protocol:           "vless",
		RealityPrivateKey:  "test-key",
		RealityShortId:     "abcd",
		RealityDest:        "www.example.com:443",
		RealityServerNames: []string{"www.example.com"},
		Routes: []api.XrayLineRoute{
			{
				LineID: 1,
				UUIDs:  []string{"uuid-aaa"},
				Port:   41443,
				Mark:   100,
			},
		},
	}

	data, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)

	inbounds := result["inbounds"].([]interface{})
	// Find the VLESS inbound (not the api-in one)
	for _, ib := range inbounds {
		ibMap := ib.(map[string]interface{})
		if ibMap["tag"] == "api-in" {
			continue
		}
		settings := ibMap["settings"].(map[string]interface{})
		clients := settings["clients"].([]interface{})
		client := clients[0].(map[string]interface{})

		if client["email"] != "uuid-aaa" {
			t.Errorf("Expected client email 'uuid-aaa', got %v", client["email"])
		}
		if client["level"] != float64(0) {
			t.Errorf("Expected client level 0, got %v", client["level"])
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && go test ./xray/ -v -run TestGenerateConfig`
Expected: FAIL — no `stats`, `api`, `policy` sections; no `email`/`level` on clients; no `api-in` inbound.

- [ ] **Step 3: Implement config changes**

In `agent/xray/config.go`, modify `GenerateConfig`:

1. Add `email` and `level` to each client in the loop (lines 34-37):

```go
		for _, uuid := range route.UUIDs {
			clients = append(clients, map[string]interface{}{
				"id":    uuid,
				"email": uuid,
				"level": 0,
				"flow":  "xtls-rprx-vision",
			})
		}
```

2. After building inbounds/outbounds/routingRules (after line 88), prepend the dokodemo-door inbound and API routing rule:

```go
	// Prepend dokodemo-door API inbound for Stats gRPC access
	apiInbound := map[string]interface{}{
		"tag":      "api-in",
		"listen":   "127.0.0.1",
		"port":     41380,
		"protocol": "dokodemo-door",
		"settings": map[string]interface{}{
			"address": "127.0.0.1",
		},
	}
	inbounds = append([]interface{}{apiInbound}, inbounds...)

	// Prepend API routing rule (must be before line routing rules)
	apiRule := map[string]interface{}{
		"type":        "field",
		"inboundTag":  []string{"api-in"},
		"outboundTag": "api",
	}
	routingRules = append([]map[string]interface{}{apiRule}, routingRules...)
```

3. Add `stats`, `api`, and `policy` to the config map (around line 100):

```go
	config := map[string]interface{}{
		"log": map[string]interface{}{
			"loglevel": "warning",
		},
		"stats": map[string]interface{}{},
		"api": map[string]interface{}{
			"tag":      "api",
			"services": []string{"StatsService"},
		},
		"policy": map[string]interface{}{
			"levels": map[string]interface{}{
				"0": map[string]interface{}{
					"statsUserOnline": true,
				},
			},
		},
		"inbounds":  inbounds,
		"outbounds": outbounds,
		"routing":   map[string]interface{}{"rules": routingRules},
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && go test ./xray/ -v -run TestGenerateConfig`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/xray/config.go agent/xray/config_test.go
git commit -m "feat(agent): add Xray Stats API config with UserOnline tracking"
```

---

### Task 3: Add Xray online user collection to Agent

**Files:**
- Modify: `agent/collector/collector.go`
- Modify: `agent/collector/collector_test.go`

- [ ] **Step 1: Write the failing test for JSON parsing**

Add to `agent/collector/collector_test.go`:

```go
func TestParseXrayOnlineUsers(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "two online users",
			input: `{"users":["uuid-aaa","uuid-bbb"]}`,
			want:  []string{"uuid-aaa", "uuid-bbb"},
		},
		{
			name:  "no users online",
			input: `{"users":[]}`,
			want:  nil,
		},
		{
			name:  "empty response",
			input: `{}`,
			want:  nil,
		},
		{
			name:  "invalid json",
			input: `not json`,
			want:  nil,
		},
		{
			name:  "empty string",
			input: "",
			want:  nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseXrayOnlineUsers(tt.input)
			if len(got) != len(tt.want) {
				t.Errorf("parseXrayOnlineUsers(%q) = %v, want %v", tt.input, got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("parseXrayOnlineUsers(%q)[%d] = %q, want %q", tt.input, i, got[i], tt.want[i])
				}
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && go test ./collector/ -v -run TestParseXrayOnlineUsers`
Expected: FAIL — `parseXrayOnlineUsers` undefined.

- [ ] **Step 3: Implement the collection functions**

Add to `agent/collector/collector.go`:

1. Add `"encoding/json"` and `"os/exec"` to imports:

```go
import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/wg"
)
```

2. Add the `collectXrayOnlineUsers()` and `parseXrayOnlineUsers()` functions at the end of the file:

```go
func collectXrayOnlineUsers() []string {
	cmd := exec.Command("xray", "api", "getallonlineusers", "-s", "127.0.0.1:41380", "--json")
	output, err := cmd.Output()
	if err != nil {
		// Xray not running or command failed — silently return empty
		return nil
	}
	return parseXrayOnlineUsers(string(output))
}

func parseXrayOnlineUsers(output string) []string {
	var result struct {
		Users []string `json:"users"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	if len(result.Users) == 0 {
		return nil
	}
	return result.Users
}
```

3. Update `Collect()` to include Xray online users:

```go
func Collect(serverURL string) *api.StatusReport {
	report := &api.StatusReport{IsOnline: true}
	latency := measureLatency(serverURL)
	if latency >= 0 {
		report.Latency = &latency
	}
	report.Transfers = collectTransfers()
	report.Handshakes = collectHandshakes()
	report.XrayOnlineUsers = collectXrayOnlineUsers()
	return report
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && go test ./collector/ -v`
Expected: PASS (both `TestFormatBytes` and `TestParseXrayOnlineUsers`)

- [ ] **Step 5: Verify full agent compiles**

Run: `cd agent && go build ./...`
Expected: Success.

- [ ] **Step 6: Commit**

```bash
git add agent/collector/collector.go agent/collector/collector_test.go
git commit -m "feat(agent): collect Xray online users via xray api CLI"
```

---

### Task 4: Process `xray_online_users` in platform status API

**Files:**
- Modify: `src/app/api/agent/status/route.ts`

- [ ] **Step 1: Add `xray_online_users` to the request body type**

In `src/app/api/agent/status/route.ts`, update the body type (line 18-24):

```typescript
  const body = await request.json() as {
    is_online: boolean;
    latency?: number;
    transfers?: Transfer[];
    handshakes?: Handshake[];
    xray_online_users?: string[];
  };

  const { is_online, latency, transfers = [], handshakes = [], xray_online_users = [] } = body;
```

- [ ] **Step 2: Add Xray device update logic after the WG handshake loop**

After the existing `for (const h of handshakes)` loop (after line 83), add:

```typescript
  // Update Xray device online status
  // For each online UUID, set lastHandshake = now so the 10-minute threshold logic works
  const now = new Date().toISOString();
  for (const uuid of xray_online_users) {
    const device = db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.xrayUuid, uuid))
      .get();
    if (device) {
      db.update(devices)
        .set({
          lastHandshake: now,
          updatedAt: now,
        })
        .where(eq(devices.id, device.id))
        .run();
    }
  }
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: Success.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/status/route.ts
git commit -m "feat(api): process xray_online_users in agent status endpoint"
```

---

### Task 5: Remove Xray "-" special case from status computation and frontend

**Files:**
- Modify: `src/lib/device-status.ts`
- Modify: `src/app/(dashboard)/devices/page.tsx`

- [ ] **Step 1: Update `computeDeviceStatus` to remove Xray special case**

In `src/lib/device-status.ts`, change `computeDeviceStatus` to:

```typescript
export function computeDeviceStatus(lastHandshake: string | null): "online" | "offline" {
  return isDeviceOnline(lastHandshake) ? "online" : "offline";
}
```

The function no longer needs the `protocol` parameter or the `"-"` return type.

- [ ] **Step 2: Update all callers to remove the `protocol` argument**

In `src/app/api/devices/route.ts` (line 77), change:

```typescript
    status: computeDeviceStatus(row.lastHandshake, row.protocol),
```
to:
```typescript
    status: computeDeviceStatus(row.lastHandshake),
```

Search for any other callers:

Run: `grep -rn "computeDeviceStatus" src/`

Update each caller to remove the second argument.

- [ ] **Step 3: Remove "-" status handling from the devices page**

In `src/app/(dashboard)/devices/page.tsx`:

1. Remove `"-": "-"` from `STATUS_LABELS` (line 43).

2. Remove `"-": "outline"` from `STATUS_VARIANTS` (line 53).

3. Simplify the status column render (lines 276-283) — remove the `"-"` branch:

```typescript
    {
      key: "status",
      label: "状态",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status] ?? "secondary"}>
          {STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: Success.

- [ ] **Step 5: Commit**

```bash
git add src/lib/device-status.ts src/app/api/devices/route.ts src/app/(dashboard)/devices/page.tsx
git commit -m "feat(ui): show online/offline status for Xray devices"
```

---

### Task 6: Run all tests and verify

**Files:** None (verification only)

- [ ] **Step 1: Run Go agent tests**

Run: `cd agent && go test ./...`
Expected: All tests pass.

- [ ] **Step 2: Run Next.js build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Final commit (if any fixes needed)**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: address test/build issues for Xray online status"
```
