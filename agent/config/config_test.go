package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadValidConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	content := `
server_url: "https://example.com:3000"
node_id: 42
token: "test-token-abc"
report_interval: 60
`
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.ServerURL != "https://example.com:3000" {
		t.Errorf("server_url = %q, want %q", cfg.ServerURL, "https://example.com:3000")
	}
	if cfg.NodeID != 42 {
		t.Errorf("node_id = %d, want 42", cfg.NodeID)
	}
	if cfg.Token != "test-token-abc" {
		t.Errorf("token = %q, want %q", cfg.Token, "test-token-abc")
	}
	if cfg.ReportInterval != 60 {
		t.Errorf("report_interval = %d, want 60", cfg.ReportInterval)
	}
}

func TestLoadDefaultReportInterval(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	content := `
server_url: "https://example.com"
node_id: 1
token: "tok"
`
	os.WriteFile(path, []byte(content), 0644)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReportInterval != 300 {
		t.Errorf("default report_interval = %d, want 300", cfg.ReportInterval)
	}
}

func TestLoadMissingFields(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")

	tests := []struct {
		name    string
		content string
	}{
		{"missing server_url", "node_id: 1\ntoken: tok\n"},
		{"missing node_id", "server_url: http://x\ntoken: tok\n"},
		{"missing token", "server_url: http://x\nnode_id: 1\n"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.WriteFile(path, []byte(tt.content), 0644)
			_, err := Load(path)
			if err == nil {
				t.Errorf("expected error for %s", tt.name)
			}
		})
	}
}

func TestLoadFileNotFound(t *testing.T) {
	_, err := Load("/nonexistent/path.yaml")
	if err == nil {
		t.Error("expected error for missing file")
	}
}
