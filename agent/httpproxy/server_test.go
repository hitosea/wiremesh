package httpproxy

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// resetHttpStats clears package-level counters between tests.
func resetHttpStats(t *testing.T) {
	t.Helper()
	statsMu.Lock()
	defer statsMu.Unlock()
	stats = make(map[int]*lineStats)
}

func TestCheckAuth(t *testing.T) {
	creds := map[string]string{"alice": "secret"}

	mkReq := func(authVal string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
		if authVal != "" {
			r.Header.Set("Proxy-Authorization", authVal)
		}
		return r
	}

	// "alice:secret" base64 = YWxpY2U6c2VjcmV0
	if !checkAuth(mkReq("Basic YWxpY2U6c2VjcmV0"), creds) {
		t.Error("valid credentials should pass")
	}
	if checkAuth(mkReq("Basic YWxpY2U6d3Jvbmc="), creds) { // alice:wrong
		t.Error("wrong password should fail")
	}
	if checkAuth(mkReq(""), creds) {
		t.Error("missing header should fail")
	}
	if checkAuth(mkReq("Bearer x"), creds) {
		t.Error("non-Basic scheme should fail")
	}
	// Empty creds map = no auth required.
	if !checkAuth(mkReq(""), map[string]string{}) {
		t.Error("empty creds means open proxy")
	}
}

func TestConnectTunnel(t *testing.T) {
	resetHttpStats(t)

	// Fake upstream: echo server.
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()
	go func() {
		c, err := upstream.Accept()
		if err != nil {
			return
		}
		io.Copy(c, c) // echo
		c.Close()
	}()

	// Injected dialer (no SO_MARK) pointing at the echo server, wrapped in
	// countingConn so byte counters fire — exercises CollectTransfers too.
	s := getOrCreateStats(7)
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := net.Dial("tcp", upstream.Addr().String())
		if err != nil {
			return nil, err
		}
		return &countingConn{Conn: c, s: s}, nil
	}

	// Two real TCP endpoints for the client<->proxy hop.
	clientConn, proxyConn := net.Pipe()
	proxyDone := make(chan struct{})
	go func() {
		handleConn(proxyConn, nil, dial)
		close(proxyDone)
	}()

	// Client sends CONNECT, then payload, expects echo back.
	go func() {
		fmt.Fprintf(clientConn, "CONNECT echo:443 HTTP/1.1\r\nHost: echo:443\r\n\r\n")
	}()

	br := bufio.NewReader(clientConn)
	status, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("reading status line: %v", err)
	}
	if !strings.Contains(status, "200") {
		t.Fatalf("expected 200, got %q", status)
	}
	// Drain the blank line ending headers.
	for {
		line, _ := br.ReadString('\n')
		if line == "\r\n" || line == "\n" || line == "" {
			break
		}
	}

	// Now the tunnel is open: send and read echo.
	fmt.Fprint(clientConn, "ping")
	buf := make([]byte, 4)
	if _, err := io.ReadFull(br, buf); err != nil {
		t.Fatalf("reading echo: %v", err)
	}
	if string(buf) != "ping" {
		t.Fatalf("expected echoed 'ping', got %q", string(buf))
	}
	clientConn.Close()

	// Wait for handleConn and all tunnel goroutines to finish so that
	// countingConn.WriteTo's deferred counter update (added for splice fast
	// path) has been applied before we read the stats.
	<-proxyDone

	reports := CollectTransfers()
	if len(reports) == 0 {
		t.Fatal("expected non-zero transfer report after tunneling")
	}
}

// loopbackPair returns a connected pair of real TCP connections over loopback.
// Unlike net.Pipe, these have OS-level buffers so concurrent reads/writes
// in the proxy's goroutines don't deadlock.
func loopbackPair(t *testing.T) (client, server net.Conn) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	ch := make(chan net.Conn, 1)
	go func() {
		c, err := ln.Accept()
		if err != nil {
			ch <- nil
			return
		}
		ch <- c
	}()
	client, err = net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server = <-ch
	if server == nil {
		t.Fatal("loopbackPair: accept failed")
	}
	return client, server
}

// TestPlainForward verifies that a plain HTTP (non-CONNECT) absolute-URI
// request is forwarded to the upstream and the response is relayed.
func TestPlainForward(t *testing.T) {
	resetHttpStats(t)

	const lineID = 11

	// Real upstream that asserts origin-form request and writes a known body.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/page" {
			t.Errorf("upstream: expected path /page, got %q", r.URL.Path)
		}
		if strings.Contains(r.RequestURI, "http://") {
			t.Errorf("upstream: RequestURI should be origin-form, got %q", r.RequestURI)
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "forwarded-ok")
	}))
	defer upstream.Close()

	// Injected dialer: always connect to the upstream, ignoring the requested addr.
	s := getOrCreateStats(lineID)
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := net.Dial("tcp", upstream.Listener.Addr().String())
		if err != nil {
			return nil, err
		}
		return &countingConn{Conn: c, s: s}, nil
	}

	// Real loopback TCP pair for the client<->proxy hop.
	clientConn, proxyConn := loopbackPair(t)
	defer clientConn.Close()

	go handleConn(proxyConn, nil, dial)

	// Write an absolute-form proxy request.
	fmt.Fprint(clientConn, "GET http://example.com/page HTTP/1.1\r\nHost: example.com\r\n\r\n")

	resp, err := http.ReadResponse(bufio.NewReader(clientConn), nil)
	if err != nil {
		t.Fatalf("reading response: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "forwarded-ok") {
		t.Fatalf("expected body to contain 'forwarded-ok', got %q", string(body))
	}
}

// TestProxyAuthRequired verifies that a request without Proxy-Authorization
// credentials gets a 407 response with a Proxy-Authenticate header.
func TestProxyAuthRequired(t *testing.T) {
	resetHttpStats(t)

	creds := map[string]string{"alice": "secret"}

	// dial is a stub; it won't be reached because auth fails first.
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		return nil, fmt.Errorf("should not be called")
	}

	// Real loopback TCP pair.
	clientConn, proxyConn := loopbackPair(t)
	defer clientConn.Close()

	go handleConn(proxyConn, creds, dial)

	// Send a request with NO Proxy-Authorization header.
	fmt.Fprint(clientConn, "GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n")

	resp, err := http.ReadResponse(bufio.NewReader(clientConn), nil)
	if err != nil {
		t.Fatalf("reading response: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusProxyAuthRequired {
		t.Fatalf("expected 407, got %d", resp.StatusCode)
	}
	if resp.Header.Get("Proxy-Authenticate") == "" {
		t.Fatal("expected Proxy-Authenticate header in 407 response")
	}
}
