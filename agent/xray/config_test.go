package xray

import (
	"encoding/json"
	"testing"

	"github.com/wiremesh/agent/api"
)

func TestGenerateConfig_StatsAndAPI(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled: true,
		Inbounds: []api.XrayInbound{
			{
				LineID:             1,
				Transport:          "reality",
				Protocol:           "vless",
				Port:               41443,
				RealityPrivateKey:  "test-private-key",
				RealityShortId:     "abcd1234",
				RealityDest:        "www.example.com:443",
				RealityServerNames: []string{"www.example.com"},
				UUIDs:              []string{"uuid-aaa", "uuid-bbb"},
				Mark:               100,
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
	services, ok := apiSection["services"].([]interface{})
	if !ok || len(services) != 1 || services[0] != "StatsService" {
		t.Errorf("Expected api services [StatsService], got %v", apiSection["services"])
	}

	// policy section with statsUserOnline
	policySection, ok := result["policy"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected 'policy' section in config")
	}
	levels := policySection["levels"].(map[string]interface{})
	level0 := levels["0"].(map[string]interface{})
	for _, key := range []string{"statsUserOnline", "statsUserUplink", "statsUserDownlink"} {
		if level0[key] != true {
			t.Errorf("policy.levels.0.%s = %v, want true", key, level0[key])
		}
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
			if ibMap["port"] != float64(XrayAPIPort) {
				t.Errorf("API inbound should use port %d, got %v", XrayAPIPort, ibMap["port"])
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
		Enabled: true,
		Inbounds: []api.XrayInbound{
			{
				LineID:             1,
				Transport:          "reality",
				Protocol:           "vless",
				Port:               41443,
				RealityPrivateKey:  "test-key",
				RealityShortId:     "abcd",
				RealityDest:        "www.example.com:443",
				RealityServerNames: []string{"www.example.com"},
				UUIDs:              []string{"uuid-aaa"},
				Mark:               100,
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

func TestGenerateConfig_RealityInbound(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled: true,
		Inbounds: []api.XrayInbound{{
			LineID:             1,
			Transport:          "reality",
			Protocol:           "vless",
			Port:               41443,
			RealityPrivateKey:  "priv",
			RealityShortId:     "abcd",
			RealityDest:        "www.x.com:443",
			RealityServerNames: []string{"www.x.com"},
			UUIDs:              []string{"u1", "u2"},
			Mark:               100,
		}},
	}
	data, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var r map[string]interface{}
	_ = json.Unmarshal(data, &r)
	inb := findInboundByTag(r, "in-line-1-reality")
	if inb == nil {
		t.Fatal("missing reality inbound")
	}
	ss := inb["streamSettings"].(map[string]interface{})
	if ss["security"] != "reality" {
		t.Errorf("want security=reality, got %v", ss["security"])
	}
}

func TestGenerateConfig_WsTlsInbound(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled: true,
		Inbounds: []api.XrayInbound{{
			LineID:    1,
			Transport: "ws-tls",
			Protocol:  "vless",
			Port:      41444,
			WsPath:    "/abc",
			TlsDomain: "node.example.com",
			UUIDs:     []string{"u3"},
			Mark:      101,
		}},
	}
	data, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var r map[string]interface{}
	_ = json.Unmarshal(data, &r)
	inb := findInboundByTag(r, "in-line-1-ws-tls")
	if inb == nil {
		t.Fatal("missing ws-tls inbound")
	}
	ss := inb["streamSettings"].(map[string]interface{})
	if ss["network"] != "ws" || ss["security"] != "tls" {
		t.Errorf("want ws/tls, got %v/%v", ss["network"], ss["security"])
	}
}

func TestGenerateConfig_BothTransportsForOneLine(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled: true,
		Inbounds: []api.XrayInbound{
			{LineID: 1, Transport: "reality", Protocol: "vless", Port: 41443,
				RealityPrivateKey: "k", RealityShortId: "id", RealityDest: "x:443",
				RealityServerNames: []string{"x"}, UUIDs: []string{"u1"}, Mark: 100},
			{LineID: 1, Transport: "ws-tls", Protocol: "vless", Port: 41444,
				WsPath: "/p", TlsDomain: "x", UUIDs: []string{"u2"}, Mark: 100},
		},
	}
	data, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var r map[string]interface{}
	_ = json.Unmarshal(data, &r)
	if findInboundByTag(r, "in-line-1-reality") == nil {
		t.Error("missing reality")
	}
	if findInboundByTag(r, "in-line-1-ws-tls") == nil {
		t.Error("missing ws-tls")
	}
}

func TestGenerateConfig_DualTransportTagUniqueness(t *testing.T) {
	cfg := &api.XrayConfig{
		Enabled: true,
		Inbounds: []api.XrayInbound{
			{LineID: 1, Transport: "reality", Protocol: "vless", Port: 41443,
				RealityPrivateKey: "k", RealityShortId: "id", RealityDest: "x:443",
				RealityServerNames: []string{"x"}, UUIDs: []string{"u1"}, Mark: 100},
			{LineID: 1, Transport: "ws-tls", Protocol: "vless", Port: 41444,
				WsPath: "/p", TlsDomain: "x.com", UUIDs: []string{"u2"}, Mark: 100},
		},
	}
	data, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var r map[string]interface{}
	_ = json.Unmarshal(data, &r)

	// Inbound tags must be distinct
	inbounds := r["inbounds"].([]interface{})
	seen := make(map[string]bool)
	for _, ib := range inbounds {
		tag := ib.(map[string]interface{})["tag"].(string)
		if seen[tag] {
			t.Errorf("duplicate inbound tag: %s", tag)
		}
		seen[tag] = true
	}

	// Outbound tags must be distinct
	outbounds := r["outbounds"].([]interface{})
	seenOut := make(map[string]bool)
	for _, ob := range outbounds {
		tag := ob.(map[string]interface{})["tag"].(string)
		if seenOut[tag] {
			t.Errorf("duplicate outbound tag: %s", tag)
		}
		seenOut[tag] = true
	}

	// Should see in-line-1-reality, in-line-1-ws-tls, out-line-1-reality, out-line-1-ws-tls, plus api/direct
	expectedInbound := []string{"in-line-1-reality", "in-line-1-ws-tls"}
	for _, tag := range expectedInbound {
		if !seen[tag] {
			t.Errorf("missing inbound tag: %s", tag)
		}
	}
	expectedOutbound := []string{"out-line-1-reality", "out-line-1-ws-tls"}
	for _, tag := range expectedOutbound {
		if !seenOut[tag] {
			t.Errorf("missing outbound tag: %s", tag)
		}
	}
}

func findInboundByTag(r map[string]interface{}, tag string) map[string]interface{} {
	for _, ib := range r["inbounds"].([]interface{}) {
		m := ib.(map[string]interface{})
		if m["tag"] == tag {
			return m
		}
	}
	return nil
}
