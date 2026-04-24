package dns

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"syscall"
	"time"

	mdns "github.com/miekg/dns"
	"github.com/wiremesh/agent/ipset"
)

const tlsScheme = "tls://"

type upstreamServer struct {
	addr  string
	isTLS bool
}

// Proxy is a forwarding DNS proxy that intercepts matching domains
// and adds resolved IPs to ipsets for policy routing.
type Proxy struct {
	listenAddr string
	upstream   []upstreamServer
	matcher    *DomainMatcher
	server     *mdns.Server
	udpClient  *mdns.Client
	tlsClient  *mdns.Client
	tlsConns   map[string]*mdns.Conn
	tlsConnMu  sync.Mutex
	mu         sync.Mutex
	running    bool
}

func normalizeAddr(addr, defaultPort string) string {
	if _, _, err := net.SplitHostPort(addr); err != nil {
		return addr + ":" + defaultPort
	}
	return addr
}

func parseUpstream(raw []string) []upstreamServer {
	var servers []upstreamServer
	for _, u := range raw {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if strings.HasPrefix(u, tlsScheme) {
			servers = append(servers, upstreamServer{
				addr:  normalizeAddr(strings.TrimPrefix(u, tlsScheme), "853"),
				isTLS: true,
			})
		} else {
			servers = append(servers, upstreamServer{
				addr: normalizeAddr(u, "53"),
			})
		}
	}
	return servers
}

// bindDialer returns a net.Dialer that binds outbound sockets to iface via
// SO_BINDTODEVICE. Used to force DNS upstream queries through a tunnel
// interface so GFW on the host's public path can't interfere.
func bindDialer(iface string, timeout time.Duration) *net.Dialer {
	d := &net.Dialer{Timeout: timeout}
	if iface == "" {
		return d
	}
	d.Control = func(network, address string, c syscall.RawConn) error {
		var opErr error
		err := c.Control(func(fd uintptr) {
			opErr = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, iface)
		})
		if err != nil {
			return err
		}
		return opErr
	}
	return d
}

func NewProxy(listenAddr string, upstream []string) *Proxy {
	return NewProxyWithBind(listenAddr, upstream, "")
}

// NewProxyWithBind creates a DNS proxy whose upstream queries are bound to
// the given network interface via SO_BINDTODEVICE. Use an empty bindDevice
// to disable binding.
func NewProxyWithBind(listenAddr string, upstream []string, bindDevice string) *Proxy {
	timeout := 3 * time.Second
	dialer := bindDialer(bindDevice, timeout)
	return &Proxy{
		listenAddr: listenAddr,
		upstream:   parseUpstream(upstream),
		matcher:    NewDomainMatcher(),
		udpClient: &mdns.Client{
			Timeout: timeout,
			Dialer:  dialer,
		},
		tlsClient: &mdns.Client{
			Net:     "tcp-tls",
			Timeout: timeout,
			TLSConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
			Dialer: dialer,
		},
		tlsConns: make(map[string]*mdns.Conn),
	}
}

// UpdateRules replaces the domain matching rules.
// Each domain may map to multiple ipsets (same filter bound to multiple branches).
func (p *Proxy) UpdateRules(rules map[string][]string) {
	p.matcher.SetRules(rules)
	log.Printf("[dns] Updated domain rules: %d entries", len(rules))
}

func (p *Proxy) MergeRules(rules map[string][]string) {
	p.matcher.MergeRules(rules)
	log.Printf("[dns] Merged domain rules: %d new entries", len(rules))
}

// Start begins listening for DNS queries.
func (p *Proxy) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return nil
	}

	mux := mdns.NewServeMux()
	mux.HandleFunc(".", p.handleQuery)

	p.server = &mdns.Server{
		Addr:    p.listenAddr,
		Net:     "udp",
		Handler: mux,
	}

	go func() {
		log.Printf("[dns] Starting DNS proxy on %s", p.listenAddr)
		if err := p.server.ListenAndServe(); err != nil {
			log.Printf("[dns] DNS proxy error: %v", err)
		}
	}()

	p.running = true
	return nil
}

// Stop shuts down the DNS proxy.
func (p *Proxy) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return
	}
	if p.server != nil {
		p.server.Shutdown()
	}
	p.tlsConnMu.Lock()
	for addr, conn := range p.tlsConns {
		conn.Close()
		delete(p.tlsConns, addr)
	}
	p.tlsConnMu.Unlock()
	p.running = false
	log.Println("[dns] DNS proxy stopped")
}

func (p *Proxy) handleQuery(w mdns.ResponseWriter, r *mdns.Msg) {
	resp, err := p.forward(r)
	if err != nil {
		log.Printf("[dns] Forward error: %v", err)
		msg := new(mdns.Msg)
		msg.SetRcode(r, mdns.RcodeServerFailure)
		w.WriteMsg(msg)
		return
	}

	for _, q := range r.Question {
		if q.Qtype != mdns.TypeA && q.Qtype != mdns.TypeAAAA {
			continue
		}
		ipsetNames, matched := p.matcher.Match(q.Name)
		if !matched {
			continue
		}

		for _, ans := range resp.Answer {
			var ip string
			var ttl uint32
			switch rr := ans.(type) {
			case *mdns.A:
				ip = rr.A.String()
				ttl = rr.Hdr.Ttl
			case *mdns.AAAA:
				ip = rr.AAAA.String()
				ttl = rr.Hdr.Ttl
			default:
				continue
			}

			if ttl < 60 {
				ttl = 60
			}

			for _, ipsetName := range ipsetNames {
				if err := ipset.Add(ipsetName, ip, int(ttl)); err != nil {
					log.Printf("[dns] Failed to add %s to ipset %s: %v", ip, ipsetName, err)
				}
			}
		}
	}

	w.WriteMsg(resp)
}

func (p *Proxy) getTLSConn(addr string) (*mdns.Conn, error) {
	p.tlsConnMu.Lock()
	conn, ok := p.tlsConns[addr]
	p.tlsConnMu.Unlock()

	if ok {
		return conn, nil
	}

	newConn, err := p.tlsClient.Dial(addr)
	if err != nil {
		return nil, err
	}

	p.tlsConnMu.Lock()
	p.tlsConns[addr] = newConn
	p.tlsConnMu.Unlock()

	return newConn, nil
}

func (p *Proxy) closeTLSConn(addr string) {
	p.tlsConnMu.Lock()
	if conn, ok := p.tlsConns[addr]; ok {
		conn.Close()
		delete(p.tlsConns, addr)
	}
	p.tlsConnMu.Unlock()
}

func (p *Proxy) exchangeTLS(r *mdns.Msg, addr string) (*mdns.Msg, error) {
	conn, err := p.getTLSConn(addr)
	if err != nil {
		return nil, err
	}

	conn.SetDeadline(time.Now().Add(3 * time.Second))
	resp, _, err := p.tlsClient.ExchangeWithConn(r, conn)
	if err != nil {
		p.closeTLSConn(addr)
		// Retry once with fresh connection
		conn, err = p.getTLSConn(addr)
		if err != nil {
			return nil, err
		}
		conn.SetDeadline(time.Now().Add(3 * time.Second))
		resp, _, err = p.tlsClient.ExchangeWithConn(r, conn)
		if err != nil {
			p.closeTLSConn(addr)
			return nil, err
		}
	}
	return resp, nil
}

func (p *Proxy) forward(r *mdns.Msg) (*mdns.Msg, error) {
	type result struct {
		resp *mdns.Msg
		err  error
	}

	ch := make(chan result, len(p.upstream))
	for _, upstream := range p.upstream {
		go func(u upstreamServer) {
			if u.isTLS {
				resp, err := p.exchangeTLS(r, u.addr)
				ch <- result{resp, err}
			} else {
				resp, _, err := p.udpClient.Exchange(r, u.addr)
				ch <- result{resp, err}
			}
		}(upstream)
	}

	var lastErr error
	for range p.upstream {
		res := <-ch
		if res.err == nil {
			return res.resp, nil
		}
		lastErr = res.err
	}
	return nil, fmt.Errorf("all upstream DNS servers failed: %w", lastErr)
}
