package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSSEReceivesEvents(t *testing.T) {
	events := []struct {
		event string
		data  string
	}{
		{"connected", `{"status":"ok"}`},
		{"peer_update", `{"peer":"abc"}`},
		{"tunnel_update", `{"tunnel":"xyz"}`},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/sse" {
			t.Errorf("expected path /api/agent/sse, got %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") == "" {
			t.Error("expected Authorization header")
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("expected Accept: text/event-stream, got %s", r.Header.Get("Accept"))
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(200)

		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter does not support Flusher")
			return
		}

		for _, ev := range events {
			fmt.Fprintf(w, "event: %s\n", ev.event)
			fmt.Fprintf(w, "data: %s\n", ev.data)
			fmt.Fprintf(w, "\n")
			flusher.Flush()
		}
		// Close the connection after all events are sent
	}))
	defer server.Close()

	client := NewClient(server.URL, "sse-token")
	sseClient := NewSSEClient(client)
	sseClient.Start()
	defer sseClient.Stop()

	received := make([]SSEEvent, 0, len(events))
	timeout := time.After(5 * time.Second)

	for len(received) < len(events) {
		select {
		case ev, ok := <-sseClient.Events():
			if !ok {
				// Channel closed — no more events
				goto done
			}
			received = append(received, ev)
		case <-timeout:
			t.Fatalf("timed out waiting for SSE events, received %d/%d", len(received), len(events))
		}
	}

done:
	if len(received) != len(events) {
		t.Fatalf("expected %d events, got %d", len(events), len(received))
	}
	for i, ev := range received {
		if ev.Event != events[i].event {
			t.Errorf("event[%d]: expected event %q, got %q", i, events[i].event, ev.Event)
		}
		if ev.Data != events[i].data {
			t.Errorf("event[%d]: expected data %q, got %q", i, events[i].data, ev.Data)
		}
	}
}
