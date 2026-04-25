package socks5

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"syscall"

	gosocks5 "github.com/armon/go-socks5"
	"golang.org/x/sys/unix"

	"github.com/wiremesh/agent/api"
)

// Package-level so the collector can poll deltas without holding a Manager reference.
type lineStats struct {
	upload       atomic.Int64 // bytes client→destination, hot-path writes
	download     atomic.Int64 // bytes destination→client, hot-path writes
	prevUpload   int64        // accessed only under statsMu
	prevDownload int64        // accessed only under statsMu
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

// countingConn counts proxied bytes. gosocks5 io.Copy's the client conn against
// this destination conn, so Write is client-upload and Read is client-download.
// ReadFrom/WriteTo preserve the splice/sendfile fast path that the unwrapped
// *net.TCPConn provides — without them, io.Copy falls back to userspace buffer
// copying and SOCKS5 throughput drops.
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
// Lines with zero delta are omitted. The deltaUp/Down < 0 branches defend
// against counter wraparound, matching collectTransfers/collectXrayTransfers.
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

// listenTCPReuse creates a TCP listener with SO_REUSEADDR + SO_REUSEPORT set.
// Without these, immediate re-listen after Close() on the same port fails with
// EADDRINUSE because the kernel hasn't yet released the old socket. That path
// is hit on every config Sync, since the manager unconditionally closes and
// re-binds to pick up credential changes.
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

// Manager manages per-line SOCKS5 servers.
type Manager struct {
	mu      sync.Mutex
	servers map[int]*lineServer // lineId -> server
}

type lineServer struct {
	listener net.Listener
	cancel   context.CancelFunc
}

func NewManager() *Manager {
	return &Manager{
		servers: make(map[int]*lineServer),
	}
}

// Sync applies the SOCKS5 configuration. Starts/stops servers as needed.
func (m *Manager) Sync(cfg *api.Socks5Config) {
	m.mu.Lock()
	defer m.mu.Unlock()

	desired := make(map[int]api.Socks5Route)
	if cfg != nil {
		for _, r := range cfg.Routes {
			desired[r.LineID] = r
		}
	}

	// Stop servers for removed lines
	for lineId, srv := range m.servers {
		if _, ok := desired[lineId]; !ok {
			log.Printf("[socks5] Stopping server for line %d", lineId)
			srv.cancel()
			srv.listener.Close()
			delete(m.servers, lineId)
		}
	}

	// Start/restart servers for desired lines
	for lineId, route := range desired {
		if existing, ok := m.servers[lineId]; ok {
			// Always restart to pick up credential changes
			existing.cancel()
			existing.listener.Close()
			delete(m.servers, lineId)
		}
		m.startServer(lineId, route)
	}
}

func (m *Manager) startServer(lineId int, route api.Socks5Route) {
	creds := make(gosocks5.StaticCredentials)
	for _, u := range route.Users {
		creds[u.Username] = u.Password
	}

	conf := &gosocks5.Config{
		AuthMethods: []gosocks5.Authenticator{gosocks5.UserPassAuthenticator{Credentials: creds}},
		Dial:        makeDialer(lineId, route.Mark),
	}

	server, err := gosocks5.New(conf)
	if err != nil {
		log.Printf("[socks5] Failed to create server for line %d: %v", lineId, err)
		return
	}

	listener, err := listenTCPReuse(fmt.Sprintf(":%d", route.Port))
	if err != nil {
		log.Printf("[socks5] Failed to listen on port %d for line %d: %v", route.Port, lineId, err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.servers[lineId] = &lineServer{listener: listener, cancel: cancel}

	go func() {
		log.Printf("[socks5] Server started for line %d on port %d (%d users)", lineId, route.Port, len(route.Users))
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					log.Printf("[socks5] Accept error on line %d: %v", lineId, err)
					return
				}
			}
			go server.ServeConn(conn)
		}
	}()
}

// Stop shuts down all SOCKS5 servers.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for lineId, srv := range m.servers {
		srv.cancel()
		srv.listener.Close()
		delete(m.servers, lineId)
	}
	log.Println("[socks5] All servers stopped")
}

// makeDialer returns a dial function that sets SO_MARK on outgoing connections
// and wraps the result so per-line byte counters update on every Read/Write.
func makeDialer(lineId int, mark int) func(ctx context.Context, network, addr string) (net.Conn, error) {
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
