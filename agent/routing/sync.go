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
	"github.com/wiremesh/agent/ipset"
)

// SourceSyncer periodically fetches external rule sources and updates routing.
//
// The syncer maintains per-filter caches of fetched IPs/domains and, on every
// fetch, rebuilds the affected branch's *-cidr ipset via atomic swap
// (collecting static IPs from Manager.lastConfig + all filters' cached IPs on
// the same branch). It never touches iptables — the mangle rules emitted by
// the Manager reference the ipset by name and remain stable.
type SourceSyncer struct {
	manager       *Manager
	timers        map[int]*time.Timer // filter_id -> timer
	filterBranch  map[int]int         // filter_id -> branch_id (for rebuild scope)
	filterIPs     map[int][]string    // filter_id -> last fetched IPs
	mu            sync.Mutex
	client        *http.Client
	stopCh        chan struct{}
	stopped       bool
}

func NewSourceSyncer(manager *Manager) *SourceSyncer {
	return &SourceSyncer{
		manager:      manager,
		timers:       make(map[int]*time.Timer),
		filterBranch: make(map[int]int),
		filterIPs:    make(map[int][]string),
		client:       &http.Client{Timeout: 30 * time.Second},
		stopCh:       make(chan struct{}),
	}
}

// UpdateSources sets up timers for all external rule sources.
// Stale filters (removed from config or reassigned to a different branch) are
// dropped from the per-filter cache so the next rebuild reflects reality.
func (s *SourceSyncer) UpdateSources(branches []api.RoutingBranch) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop existing timers
	for _, timer := range s.timers {
		timer.Stop()
	}
	s.timers = make(map[int]*time.Timer)

	// Rebuild filter->branch mapping from current config; drop caches for
	// filters that are no longer present.
	newFilterBranch := make(map[int]int)
	affectedBranches := make(map[int]struct{})
	for _, branch := range branches {
		for _, src := range branch.RuleSources {
			newFilterBranch[src.FilterID] = branch.ID
			affectedBranches[branch.ID] = struct{}{}
		}
	}
	for fid := range s.filterIPs {
		if _, ok := newFilterBranch[fid]; !ok {
			delete(s.filterIPs, fid)
		}
	}
	s.filterBranch = newFilterBranch
	s.mu.Unlock()

	// Rebuild each affected branch's -cidr ipset from cached external IPs
	// immediately. Without this, the window between Sync (which flushes the
	// ipset and fills it with static IPs only) and the next fetch returning
	// would leave external-source IPs unresolved. Rebuilds don't need to wait
	// for network I/O since we have last-known data in cache.
	for branchID := range affectedBranches {
		if err := s.rebuildBranchCidrSet(branchID); err != nil {
			log.Printf("[sync] initial rebuild branch=%d failed: %v", branchID, err)
		}
	}

	s.mu.Lock()
	// Start new timers — fetches run in goroutines so UpdateSources returns quickly.
	for _, branch := range branches {
		for _, src := range branch.RuleSources {
			branchID := branch.ID
			source := src
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

	// Update per-filter cache, then rebuild the branch's -cidr ipset atomically
	// (static IPs from config + union of all filters' cached IPs on this branch).
	s.mu.Lock()
	s.filterIPs[source.FilterID] = ipRules
	s.filterBranch[source.FilterID] = branchID
	s.mu.Unlock()
	if err := s.rebuildBranchCidrSet(branchID); err != nil {
		log.Printf("[sync] filter=%d rebuild ipset failed: %v", source.FilterID, err)
	}

	// Apply domain rules to DNS proxy — they land in the -dns ipset.
	if len(domainRules) > 0 && s.manager.dnsProxy != nil {
		dnsSet := fmt.Sprintf("wm-branch-%d-dns", branchID)
		newRules := make(map[string]string, len(domainRules))
		for _, d := range domainRules {
			newRules[d] = dnsSet
		}
		// Merge with existing rules (additive). Per-filter domain churn is rare
		// enough that tracking removals isn't worth the complexity here.
		s.manager.dnsProxy.MergeRules(newRules)
	}

	s.report(source.FilterID, true, len(ipRules), len(domainRules), "")
}

// rebuildBranchCidrSet atomically replaces the -cidr ipset for a branch with
// the union of static IPs (from routing config) and all cached external-source
// IPs of filters bound to the same branch. Uses ipset swap so the replacement
// is observably atomic — no packet sees a half-populated set.
func (s *SourceSyncer) rebuildBranchCidrSet(branchID int) error {
	s.mu.Lock()
	// Collect external IPs from all filters pointing at this branch.
	external := make(map[string]struct{})
	for fid, bid := range s.filterBranch {
		if bid != branchID {
			continue
		}
		for _, ip := range s.filterIPs[fid] {
			external[ip] = struct{}{}
		}
	}
	s.mu.Unlock()

	// Static IPs come from the Manager's last-applied routing config; these
	// are filter.rules entries (manually typed) that also belong in the set.
	staticIPs := s.manager.StaticIPsForBranch(branchID)

	target := fmt.Sprintf("wm-branch-%d-cidr", branchID)
	tmp := target + ".tmp"

	// Build the replacement set.
	_ = ipset.Destroy(tmp) // defensive: remove any leftover from a prior crash
	if err := ipset.CreateHash(tmp, "net"); err != nil {
		return fmt.Errorf("create tmp set %s: %w", tmp, err)
	}

	added := 0
	for _, cidr := range staticIPs {
		if err := ipset.Add(tmp, cidr, 0); err != nil {
			log.Printf("[sync] add %s to %s failed: %v", cidr, tmp, err)
			continue
		}
		added++
	}
	for cidr := range external {
		if err := ipset.Add(tmp, cidr, 0); err != nil {
			log.Printf("[sync] add %s to %s failed: %v", cidr, tmp, err)
			continue
		}
		added++
	}

	// Ensure the live set exists (it should, created by Manager.Sync), then swap.
	if !ipset.Exists(target) {
		if err := ipset.CreateHash(target, "net"); err != nil {
			_ = ipset.Destroy(tmp)
			return fmt.Errorf("create live set %s: %w", target, err)
		}
	}
	if err := ipset.Swap(target, tmp); err != nil {
		_ = ipset.Destroy(tmp)
		return err
	}
	_ = ipset.Destroy(tmp)

	log.Printf("[sync] Rebuilt %s: %d entries (static=%d external=%d)", target, added, len(staticIPs), len(external))
	return nil
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
