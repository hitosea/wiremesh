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
