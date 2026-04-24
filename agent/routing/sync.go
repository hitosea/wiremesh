package routing

import (
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wiremesh/agent/api"
)

// SourceSyncer periodically fetches external rule sources and updates routing.
type SourceSyncer struct {
	manager *Manager
	timers  map[int]*time.Timer // filter_id -> timer
	mu      sync.Mutex
	client  *http.Client
	stopCh  chan struct{}
	stopped bool
}

func NewSourceSyncer(manager *Manager) *SourceSyncer {
	return &SourceSyncer{
		manager: manager,
		timers:  make(map[int]*time.Timer),
		client:  &http.Client{Timeout: 30 * time.Second},
		stopCh:  make(chan struct{}),
	}
}

// UpdateSources sets up timers for all external rule sources.
func (s *SourceSyncer) UpdateSources(branches []api.RoutingBranch) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop existing timers
	for _, timer := range s.timers {
		timer.Stop()
	}
	s.timers = make(map[int]*time.Timer)

	// Start new timers
	for _, branch := range branches {
		for _, src := range branch.RuleSources {
			branchID := branch.ID
			source := src
			// Run immediately, then on interval
			go s.fetchAndApply(branchID, source)
			interval := time.Duration(source.SyncInterval) * time.Second
			timer := time.AfterFunc(interval, func() {
				s.periodicSync(branchID, source, interval)
			})
			s.timers[source.FilterID] = timer
		}
	}
}

func (s *SourceSyncer) periodicSync(branchID int, source api.RuleSource, interval time.Duration) {
	select {
	case <-s.stopCh:
		return
	default:
	}
	s.fetchAndApply(branchID, source)
	s.mu.Lock()
	s.timers[source.FilterID] = time.AfterFunc(interval, func() {
		s.periodicSync(branchID, source, interval)
	})
	s.mu.Unlock()
}

func (s *SourceSyncer) fetchAndApply(branchID int, source api.RuleSource) {
	log.Printf("[sync] Fetching rule source filter=%d url=%s", source.FilterID, source.URL)

	resp, err := s.client.Get(source.URL)
	if err != nil {
		msg := fmt.Sprintf("fetch failed: %v", err)
		log.Printf("[sync] filter=%d %s", source.FilterID, msg)
		s.report(source.FilterID, false, 0, 0, msg)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		msg := fmt.Sprintf("HTTP status %d", resp.StatusCode)
		log.Printf("[sync] filter=%d %s", source.FilterID, msg)
		s.report(source.FilterID, false, 0, 0, msg)
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // 10MB limit
	if err != nil {
		msg := fmt.Sprintf("read body failed: %v", err)
		log.Printf("[sync] filter=%d %s", source.FilterID, msg)
		s.report(source.FilterID, false, 0, 0, msg)
		return
	}

	// Parse lines: classify as IP/CIDR or domain
	var ipRules []string
	var domainRules []string

	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if isIPOrCIDR(line) {
			ipRules = append(ipRules, line)
		} else {
			domainRules = append(domainRules, line)
		}
	}

	log.Printf("[sync] Filter=%d parsed: %d IPs, %d domains", source.FilterID, len(ipRules), len(domainRules))

	// Apply IP rules
	if len(ipRules) > 0 {
		s.manager.ReapplyIPRules(branchID, ipRules)
	}

	// Apply domain rules to DNS proxy
	if len(domainRules) > 0 && s.manager.dnsProxy != nil {
		ipsetName := fmt.Sprintf("wm-branch-%d", branchID)
		newRules := make(map[string]string, len(domainRules))
		for _, d := range domainRules {
			newRules[d] = ipsetName
		}
		// Merge with existing rules (additive)
		s.manager.dnsProxy.MergeRules(newRules)
	}

	s.report(source.FilterID, true, len(ipRules), len(domainRules), "")
}

func (s *SourceSyncer) report(filterID int, ok bool, ipCount, domainCount int, errMsg string) {
	if s.manager.client == nil {
		return
	}
	err := s.manager.client.ReportSourceSync(filterID, &api.SourceSyncReport{
		Success:     ok,
		IPCount:     ipCount,
		DomainCount: domainCount,
		Error:       errMsg,
	})
	if err != nil {
		log.Printf("[sync] report filter=%d failed: %v", filterID, err)
	}
}

func isIPOrCIDR(s string) bool {
	if net.ParseIP(s) != nil {
		return true
	}
	_, _, err := net.ParseCIDR(s)
	return err == nil
}

// Stop stops all sync timers.
func (s *SourceSyncer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	s.stopped = true
	close(s.stopCh)
	for _, timer := range s.timers {
		timer.Stop()
	}
	s.timers = make(map[int]*time.Timer)
	log.Println("[sync] Source syncer stopped")
}
