package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchConfig(t *testing.T) {
	resp := ConfigResponse{
		Data: ConfigData{
			Node: NodeConfig{
				ID:        1,
				Name:      "node-1",
				IP:        "1.2.3.4",
				WgAddress: "10.0.0.1/24",
				WgPort:    51820,
			},
			Peers: []PeerConfig{
				{PublicKey: "abc123", AllowedIps: "10.0.0.2/32"},
			},
			Version: "v1",
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/config" {
			t.Errorf("expected path /api/agent/config, got %s", r.URL.Path)
		}
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("expected Bearer test-token, got %s", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	data, err := client.FetchConfig()
	if err != nil {
		t.Fatalf("FetchConfig failed: %v", err)
	}
	if data.Node.ID != 1 {
		t.Errorf("expected node ID 1, got %d", data.Node.ID)
	}
	if data.Node.Name != "node-1" {
		t.Errorf("expected node name node-1, got %s", data.Node.Name)
	}
	if len(data.Peers) != 1 {
		t.Errorf("expected 1 peer, got %d", len(data.Peers))
	}
	if data.Peers[0].PublicKey != "abc123" {
		t.Errorf("expected peer public key abc123, got %s", data.Peers[0].PublicKey)
	}
	if data.Version != "v1" {
		t.Errorf("expected version v1, got %s", data.Version)
	}
}

func TestReportStatus(t *testing.T) {
	latency := 42
	report := &StatusReport{
		IsOnline: true,
		Latency:  &latency,
		Transfers: []TransferReport{
			{PeerPublicKey: "pk1", UploadBytes: 100, DownloadBytes: 200},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/status" {
			t.Errorf("expected path /api/agent/status, got %s", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer my-token" {
			t.Errorf("expected Bearer my-token, got %s", r.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(r.Body)
		var parsed StatusReport
		if err := json.Unmarshal(body, &parsed); err != nil {
			t.Fatalf("failed to parse body: %v", err)
		}
		if !parsed.IsOnline {
			t.Error("expected is_online to be true")
		}
		if parsed.Latency == nil || *parsed.Latency != 42 {
			t.Error("expected latency 42")
		}
		if len(parsed.Transfers) != 1 || parsed.Transfers[0].PeerPublicKey != "pk1" {
			t.Error("expected transfer with peer pk1")
		}
		w.WriteHeader(200)
	}))
	defer server.Close()

	client := NewClient(server.URL, "my-token")
	if err := client.ReportStatus(report); err != nil {
		t.Fatalf("ReportStatus failed: %v", err)
	}
}

func TestReportError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/error" {
			t.Errorf("expected path /api/agent/error, got %s", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		body, _ := io.ReadAll(r.Body)
		var parsed ErrorReport
		if err := json.Unmarshal(body, &parsed); err != nil {
			t.Fatalf("failed to parse body: %v", err)
		}
		if parsed.Message != "something went wrong" {
			t.Errorf("expected message 'something went wrong', got %s", parsed.Message)
		}
		w.WriteHeader(200)
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok")
	if err := client.ReportError("something went wrong"); err != nil {
		t.Fatalf("ReportError failed: %v", err)
	}
}

func TestFetchConfigUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte("unauthorized"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "bad-token")
	_, err := client.FetchConfig()
	if err == nil {
		t.Fatal("expected error for 401 response, got nil")
	}
}
