package collector

import (
	"testing"

	"github.com/wiremesh/agent/api"
)

func TestParseXrayOnlineUsers(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "real xray format",
			input: `{"users":["user>>>uuid-aaa>>>online","user>>>uuid-bbb>>>online"]}`,
			want:  []string{"uuid-aaa", "uuid-bbb"},
		},
		{
			name:  "no users online",
			input: `{"users":[]}`,
			want:  nil,
		},
		{
			name:  "empty users object",
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

func TestParseXrayTransfers(t *testing.T) {
	input := `{"stat":[
		{"name":"user>>>aaa>>>traffic>>>uplink","value":1000},
		{"name":"user>>>aaa>>>traffic>>>downlink","value":5000},
		{"name":"user>>>bbb>>>traffic>>>uplink","value":200},
		{"name":"user>>>bbb>>>traffic>>>downlink","value":300}
	]}`
	got := parseXrayTransfers(input)
	if len(got) != 2 {
		t.Fatalf("expected 2 users, got %d", len(got))
	}
	byUuid := map[string][2]int64{}
	for u, v := range got {
		byUuid[u] = [2]int64{v.uplink, v.downlink}
	}
	if byUuid["aaa"] != [2]int64{1000, 5000} {
		t.Errorf("aaa got %v", byUuid["aaa"])
	}
	if byUuid["bbb"] != [2]int64{200, 300} {
		t.Errorf("bbb got %v", byUuid["bbb"])
	}
}

func TestParseXrayOnlineIpList(t *testing.T) {
	input := `{"ips":{"1.2.3.4":1776727876,"5.6.7.8":1776727877},"name":"user>>>xxx>>>online"}`
	got := parseXrayOnlineIpList(input)
	if len(got) != 2 {
		t.Fatalf("expected 2 ips, got %d", len(got))
	}
	m := map[string]int64{}
	for _, ip := range got {
		m[ip.Ip] = ip.LastSeen
	}
	if m["1.2.3.4"] != 1776727876 || m["5.6.7.8"] != 1776727877 {
		t.Errorf("parsed wrong: %v", got)
	}
}

func TestParseXrayOnlineIpListEmpty(t *testing.T) {
	if got := parseXrayOnlineIpList(`{"name":"user>>>x>>>online"}`); len(got) != 0 {
		t.Errorf("expected empty, got %v", got)
	}
}

func resetStabilizer(t *testing.T, uuids ...string) {
	t.Cleanup(func() {
		xrayIpCacheMu.Lock()
		defer xrayIpCacheMu.Unlock()
		for _, uuid := range uuids {
			delete(xrayIpCache, uuid)
		}
	})
}

func TestStabilizeXrayIpsKeepsBrieflyMissingIp(t *testing.T) {
	uuid := "test-stabilize-brief"
	resetStabilizer(t, uuid)

	base := int64(1_800_000_000)
	// Poll 1: both IPs seen.
	_ = stabilizeXrayIps(uuid, []api.XrayActiveIp{
		{Ip: "1.1.1.1", LastSeen: base},
		{Ip: "2.2.2.2", LastSeen: base},
	}, base)

	// Poll 2 (30s later): only one IP — the other briefly dropped.
	got := stabilizeXrayIps(uuid, []api.XrayActiveIp{
		{Ip: "1.1.1.1", LastSeen: base + 30},
	}, base+30)

	if len(got) != 2 {
		t.Fatalf("expected 2 stabilized IPs (sticky cache), got %d: %v", len(got), got)
	}
	ips := ipSet(got)
	if !ips["1.1.1.1"] || !ips["2.2.2.2"] {
		t.Errorf("expected both IPs present, got %v", ips)
	}
}

func TestStabilizeXrayIpsEvictsAfterWindow(t *testing.T) {
	uuid := "test-stabilize-evict"
	resetStabilizer(t, uuid)

	base := int64(1_800_000_000)
	_ = stabilizeXrayIps(uuid, []api.XrayActiveIp{
		{Ip: "1.1.1.1", LastSeen: base},
		{Ip: "2.2.2.2", LastSeen: base},
	}, base)

	// Poll well past the 180s window: only one IP is still active.
	got := stabilizeXrayIps(uuid, []api.XrayActiveIp{
		{Ip: "1.1.1.1", LastSeen: base + 200},
	}, base+200)

	if len(got) != 1 || got[0].Ip != "1.1.1.1" {
		t.Errorf("expected only 1.1.1.1 after eviction, got %v", got)
	}
}

func TestStabilizeXrayIpsEmptyAfterWindow(t *testing.T) {
	uuid := "test-stabilize-empty"
	resetStabilizer(t, uuid)

	base := int64(1_800_000_000)
	_ = stabilizeXrayIps(uuid, []api.XrayActiveIp{
		{Ip: "1.1.1.1", LastSeen: base},
	}, base)

	got := stabilizeXrayIps(uuid, nil, base+200)
	if len(got) != 0 {
		t.Errorf("expected empty after full eviction, got %v", got)
	}
	if _, stillCached := xrayIpCache[uuid]; stillCached {
		t.Errorf("expected cache entry to be removed when empty")
	}
}

func TestSweepStaleXrayIpCacheEvictsOrphanUuids(t *testing.T) {
	orphan := "test-sweep-orphan"
	live := "test-sweep-live"
	resetStabilizer(t, orphan, live)

	base := int64(1_800_000_000)
	_ = stabilizeXrayIps(orphan, []api.XrayActiveIp{{Ip: "1.1.1.1", LastSeen: base}}, base)
	_ = stabilizeXrayIps(live, []api.XrayActiveIp{{Ip: "2.2.2.2", LastSeen: base + 100}}, base+100)

	sweepStaleXrayIpCache(base + 200)

	if _, ok := xrayIpCache[orphan]; ok {
		t.Errorf("expected orphan UUID to be swept, still present")
	}
	if _, ok := xrayIpCache[live]; !ok {
		t.Errorf("expected live UUID to remain, was swept")
	}
}

func ipSet(list []api.XrayActiveIp) map[string]bool {
	out := make(map[string]bool, len(list))
	for _, ip := range list {
		out[ip.Ip] = true
	}
	return out
}

func TestParseTunnelStatuses(t *testing.T) {
	// Sample wg show all dump output (tab-separated).
	// First line for each iface is the interface line (5 fields).
	// Subsequent lines for that iface are peer lines (9 fields).
	input := "wm-wg0\tabcPRIV=\tabcPUB=\t41820\toff\n" +
		"wm-wg0\tdevicePeer=\t(none)\t(none)\t10.210.0.100/32\t1777111630\t1024\t2048\t0\n" +
		"wm-tun11\titun11PRIV=\titun11PUB=\t41834\toff\n" +
		"wm-tun11\tpeerTun11=\t(none)\t47.84.141.78:41835\t0.0.0.0/0\t0\t0\t354100\t25\n" +
		"wm-tun6\titun6PRIV=\titun6PUB=\t41832\toff\n" +
		"wm-tun6\tpeerTun6=\t(none)\t47.84.141.78:41833\t0.0.0.0/0\t1777111600\t128000000\t226000000\t25\n"

	got := parseTunnelStatuses(input)

	if len(got) != 2 {
		t.Fatalf("parseTunnelStatuses returned %d entries, want 2 (only wm-tun*)", len(got))
	}

	// Find by iface name (order may vary)
	byIface := map[string]api.TunnelStatusReport{}
	for _, r := range got {
		byIface[r.Iface] = r
	}

	tun11, ok := byIface["wm-tun11"]
	if !ok {
		t.Fatal("wm-tun11 missing")
	}
	if tun11.PeerPublicKey != "peerTun11=" {
		t.Errorf("wm-tun11 PeerPublicKey = %q, want %q", tun11.PeerPublicKey, "peerTun11=")
	}
	if tun11.LastHandshake != 0 {
		t.Errorf("wm-tun11 LastHandshake = %d, want 0", tun11.LastHandshake)
	}
	if tun11.RxBytes != 0 {
		t.Errorf("wm-tun11 RxBytes = %d, want 0", tun11.RxBytes)
	}
	if tun11.TxBytes != 354100 {
		t.Errorf("wm-tun11 TxBytes = %d, want 354100", tun11.TxBytes)
	}

	tun6, ok := byIface["wm-tun6"]
	if !ok {
		t.Fatal("wm-tun6 missing")
	}
	if tun6.LastHandshake != 1777111600 {
		t.Errorf("wm-tun6 LastHandshake = %d, want 1777111600", tun6.LastHandshake)
	}
}

func TestParseTunnelStatuses_skipsNonTunInterfaces(t *testing.T) {
	// Only wm-wg0 (device interface) — should yield 0 results.
	input := "wm-wg0\tprivkey\tpubkey\t41820\toff\n" +
		"wm-wg0\tpeer1=\t(none)\t(none)\t10.210.0.100/32\t1777111630\t1024\t2048\t0\n"
	got := parseTunnelStatuses(input)
	if len(got) != 0 {
		t.Errorf("parseTunnelStatuses returned %d entries for non-tun input, want 0", len(got))
	}
}

func TestParseTunnelStatuses_emptyInput(t *testing.T) {
	if got := parseTunnelStatuses(""); len(got) != 0 {
		t.Errorf("parseTunnelStatuses(\"\") returned %d, want 0", len(got))
	}
}

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		input int64
		want  string
	}{
		{0, "0 B"},
		{500, "500 B"},
		{1024, "1.0 KiB"},
		{1048576, "1.0 MiB"},
		{1073741824, "1.0 GiB"},
		{5368709120, "5.0 GiB"},
	}
	for _, tt := range tests {
		got := FormatBytes(tt.input)
		if got != tt.want {
			t.Errorf("FormatBytes(%d) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
