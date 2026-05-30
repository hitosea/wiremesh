package httpproxy

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"

	"golang.org/x/sys/unix"

	"github.com/wiremesh/agent/api"
)

// ---- per-line byte counters (package-level, mirrors socks5) ----

type lineStats struct {
	upload       atomic.Int64
	download     atomic.Int64
	prevUpload   int64
	prevDownload int64
}

var (
	statsMu sync.Mutex
	stats   = make(map[int]*lineStats)
)

func getOrCreateStats(lineId int) *lineStats {
	statsMu.Lock()
	defer statsMu.Unlock()
	s, ok := stats[lineId]
	if !ok {
		s = &lineStats{}
		stats[lineId] = s
	}
	return s
}

// countingConn counts proxied bytes on the destination conn. Write is
// client->destination (upload), Read is destination->client (download).
type countingConn struct {
	net.Conn
	s *lineStats
}

func (c *countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		c.s.download.Add(int64(n))
	}
	return n, err
}

func (c *countingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	if n > 0 {
		c.s.upload.Add(int64(n))
	}
	return n, err
}

func (c *countingConn) ReadFrom(r io.Reader) (int64, error) {
	if rf, ok := c.Conn.(io.ReaderFrom); ok {
		n, err := rf.ReadFrom(r)
		if n > 0 {
			c.s.upload.Add(n)
		}
		return n, err
	}
	// writeOnly hides ReadFrom on countingConn so io.Copy doesn't recurse here;
	// it'll run its generic Read/Write loop and the bytes still pass through
	// countingConn.Write so the counter stays correct.
	return io.Copy(writeOnly{c}, r)
}

func (c *countingConn) WriteTo(w io.Writer) (int64, error) {
	if wt, ok := c.Conn.(io.WriterTo); ok {
		n, err := wt.WriteTo(w)
		if n > 0 {
			c.s.download.Add(n)
		}
		return n, err
	}
	return io.Copy(w, readOnly{c})
}

type writeOnly struct{ io.Writer }
type readOnly struct{ io.Reader }

// CollectTransfers returns per-line traffic deltas since the last call.
// Mirrors socks5.CollectTransfers (wraparound-safe, zero deltas omitted).
func CollectTransfers() []api.Socks5TransferReport {
	statsMu.Lock()
	defer statsMu.Unlock()

	var reports []api.Socks5TransferReport
	for lineId, s := range stats {
		curUp := s.upload.Load()
		curDown := s.download.Load()
		deltaUp := curUp - s.prevUpload
		deltaDown := curDown - s.prevDownload
		if deltaUp < 0 {
			deltaUp = curUp
		}
		if deltaDown < 0 {
			deltaDown = curDown
		}
		s.prevUpload = curUp
		s.prevDownload = curDown
		if deltaUp > 0 || deltaDown > 0 {
			reports = append(reports, api.Socks5TransferReport{
				LineID:        lineId,
				UploadBytes:   deltaUp,
				DownloadBytes: deltaDown,
			})
		}
	}
	return reports
}

// listenTCPReuse creates a TCP listener with SO_REUSEADDR + SO_REUSEPORT so an
// immediate re-listen after Close() on the same port doesn't fail EADDRINUSE.
func listenTCPReuse(addr string) (net.Listener, error) {
	lc := net.ListenConfig{
		Control: func(network, address string, c syscall.RawConn) error {
			var opErr error
			err := c.Control(func(fd uintptr) {
				if e := syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1); e != nil {
					opErr = e
					return
				}
				if e := syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, unix.SO_REUSEPORT, 1); e != nil {
					opErr = e
				}
			})
			if err != nil {
				return err
			}
			return opErr
		},
	}
	return lc.Listen(context.Background(), "tcp", addr)
}

type dialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

// makeDialer returns a dial function that sets SO_MARK on outgoing connections
// and wraps the result so per-line byte counters update on every Read/Write.
func makeDialer(lineId int, mark int) dialFunc {
	s := getOrCreateStats(lineId)
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialer := &net.Dialer{
			Control: func(network, address string, c syscall.RawConn) error {
				return c.Control(func(fd uintptr) {
					syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, mark)
				})
			},
		}
		conn, err := dialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}
		return &countingConn{Conn: conn, s: s}, nil
	}
}

// ---- Manager ----

type Manager struct {
	mu      sync.Mutex
	servers map[int]*lineServer
}

type lineServer struct {
	listener net.Listener
	cancel   context.CancelFunc
}

func NewManager() *Manager {
	return &Manager{servers: make(map[int]*lineServer)}
}

// Sync applies the HTTP proxy configuration. Starts/stops servers as needed.
func (m *Manager) Sync(cfg *api.HttpConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()

	desired := make(map[int]api.HttpRoute)
	if cfg != nil {
		for _, r := range cfg.Routes {
			desired[r.LineID] = r
		}
	}

	for lineId, srv := range m.servers {
		if _, ok := desired[lineId]; !ok {
			log.Printf("[http] Stopping server for line %d", lineId)
			srv.cancel()
			srv.listener.Close()
			delete(m.servers, lineId)
		}
	}

	for lineId, route := range desired {
		if existing, ok := m.servers[lineId]; ok {
			// Always restart to pick up credential changes.
			existing.cancel()
			existing.listener.Close()
			delete(m.servers, lineId)
		}
		m.startServer(lineId, route)
	}
}

func (m *Manager) startServer(lineId int, route api.HttpRoute) {
	creds := make(map[string]string)
	for _, u := range route.Users {
		creds[u.Username] = u.Password
	}

	listener, err := listenTCPReuse(fmt.Sprintf(":%d", route.Port))
	if err != nil {
		log.Printf("[http] Failed to listen on port %d for line %d: %v", route.Port, lineId, err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.servers[lineId] = &lineServer{listener: listener, cancel: cancel}
	dial := makeDialer(lineId, route.Mark)

	go func() {
		log.Printf("[http] Server started for line %d on port %d (%d users)", lineId, route.Port, len(route.Users))
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					log.Printf("[http] Accept error on line %d: %v", lineId, err)
					return
				}
			}
			go handleConn(conn, creds, dial)
		}
	}()
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for lineId, srv := range m.servers {
		srv.cancel()
		srv.listener.Close()
		delete(m.servers, lineId)
	}
	log.Println("[http] All servers stopped")
}

// ---- connection handling ----

const (
	resp407 = "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"wiremesh\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	resp502 = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	resp200 = "HTTP/1.1 200 Connection Established\r\n\r\n"
)

func handleConn(client net.Conn, creds map[string]string, dial dialFunc) {
	defer client.Close()

	br := bufio.NewReader(client)
	req, err := http.ReadRequest(br)
	if err != nil {
		return
	}

	if !checkAuth(req, creds) {
		io.WriteString(client, resp407)
		return
	}

	if req.Method == http.MethodConnect {
		// req.Host is "host:port" for CONNECT.
		dst, err := dial(context.Background(), "tcp", req.Host)
		if err != nil {
			io.WriteString(client, resp502)
			return
		}
		defer dst.Close()
		io.WriteString(client, resp200)
		tunnel(client, dst, br)
		return
	}

	// Plain HTTP forwarding: absolute-form request (req.URL has a Host).
	host := req.URL.Host
	if host == "" {
		io.WriteString(client, resp502)
		return
	}
	if !strings.Contains(host, ":") {
		host += ":80"
	}
	dst, err := dial(context.Background(), "tcp", host)
	if err != nil {
		io.WriteString(client, resp502)
		return
	}
	defer dst.Close()

	// Rewrite to origin-form and strip hop-by-hop proxy headers, then relay.
	req.RequestURI = ""
	req.Header.Del("Proxy-Authorization")
	req.Header.Del("Proxy-Connection")
	if err := req.Write(dst); err != nil {
		return
	}
	io.Copy(client, dst) // dst.Read counts as download
}

// checkAuth returns true when creds is empty (open proxy) or the request carries
// a matching Proxy-Authorization: Basic header.
func checkAuth(req *http.Request, creds map[string]string) bool {
	if len(creds) == 0 {
		return true
	}
	const prefix = "Basic "
	auth := req.Header.Get("Proxy-Authorization")
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, prefix))
	if err != nil {
		return false
	}
	user, pass, ok := strings.Cut(string(decoded), ":")
	if !ok {
		return false
	}
	want, ok := creds[user]
	return ok && want == pass
}

// tunnel relays bytes both ways until either side closes. br wraps the client
// conn so any bytes buffered past the CONNECT request are flushed to dst.
func tunnel(client net.Conn, dst net.Conn, br *bufio.Reader) {
	done := make(chan struct{}, 2)
	cp := func(w io.Writer, r io.Reader) {
		io.Copy(w, r)
		done <- struct{}{}
	}
	go cp(dst, br)     // client -> dst (counts as upload via countingConn.Write)
	go cp(client, dst) // dst -> client (counts as download via countingConn.Read)
	<-done
	client.Close()
	dst.Close()
	<-done
}
