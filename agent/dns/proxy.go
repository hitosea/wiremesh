package dns

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	mdns "github.com/miekg/dns"
	"github.com/wiremesh/agent/ipset"
)

// Proxy is a forwarding DNS proxy that intercepts matching domains
// and adds resolved IPs to ipsets for policy routing.
type Proxy struct {
	listenAddr string
	upstream   []string
	matcher    *DomainMatcher
	server     *mdns.Server
	client     *mdns.Client
	mu         sync.Mutex
	running    bool
}

func NewProxy(listenAddr string, upstream []string) *Proxy {
	return &Proxy{
		listenAddr: listenAddr,
		upstream:   upstream,
		matcher:    NewDomainMatcher(),
		client:     &mdns.Client{Timeout: 5 * time.Second},
	}
}

// UpdateRules replaces the domain matching rules.
func (p *Proxy) UpdateRules(rules map[string]string) {
	p.matcher.SetRules(rules)
	log.Printf("[dns] Updated domain rules: %d entries", len(rules))
}

func (p *Proxy) MergeRules(rules map[string]string) {
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
		ipsetName, matched := p.matcher.Match(q.Name)
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

			if err := ipset.Add(ipsetName, ip, int(ttl)); err != nil {
				log.Printf("[dns] Failed to add %s to ipset %s: %v", ip, ipsetName, err)
			}
		}
	}

	w.WriteMsg(resp)
}

func (p *Proxy) forward(r *mdns.Msg) (*mdns.Msg, error) {
	for _, upstream := range p.upstream {
		addr := upstream
		if _, _, err := net.SplitHostPort(addr); err != nil {
			addr = addr + ":53"
		}
		resp, _, err := p.client.Exchange(r, addr)
		if err == nil {
			return resp, nil
		}
	}
	return nil, fmt.Errorf("all upstream DNS servers failed")
}
