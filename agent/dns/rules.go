package dns

import (
	"strings"
	"sync"
)

// DomainMatcher stores domain-to-ipset-name mappings from two independent
// sources that are managed separately so they don't clobber each other:
//
//   - static:  rules built from Manager.Sync's view of the routing config
//              (branch.DomainRules). Replaced as a unit on each Sync.
//   - external: rules fetched by SourceSyncer from per-filter sourceUrl
//              lists. Stored per filter ID so the syncer can replace one
//              filter's rules without touching others, and delete a filter's
//              rules when the filter is removed from the config.
//
// A domain may appear in both sources and/or bound to multiple branches.
// Match returns the union of every matching ipset across both sources,
// so a resolved IP lands in every relevant branch's -dns ipset.
type DomainMatcher struct {
	mu       sync.RWMutex
	static   map[string][]string         // domain -> ipset names
	external map[int]map[string][]string // filter_id -> (domain -> ipset names)
}

func NewDomainMatcher() *DomainMatcher {
	return &DomainMatcher{
		static:   make(map[string][]string),
		external: make(map[int]map[string][]string),
	}
}

// SetStatic replaces the entire set of static rules in one shot.
func (m *DomainMatcher) SetStatic(rules map[string][]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.static = normalize(rules)
}

// SetFilter replaces the rules contributed by a single sourceUrl filter.
// Rules from other filters are unaffected.
func (m *DomainMatcher) SetFilter(filterID int, rules map[string][]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(rules) == 0 {
		delete(m.external, filterID)
		return
	}
	m.external[filterID] = normalize(rules)
}

// DeleteFilter drops all rules contributed by a filter (e.g. when the filter
// is removed from the routing config).
func (m *DomainMatcher) DeleteFilter(filterID int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.external, filterID)
}

// RetainFilters drops all filter rules whose IDs are not in keep. Used by
// SourceSyncer to prune filters that disappeared from the config.
func (m *DomainMatcher) RetainFilters(keep map[int]struct{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for fid := range m.external {
		if _, ok := keep[fid]; !ok {
			delete(m.external, fid)
		}
	}
}

// Match returns every ipset name the query domain should be added to,
// unioned across static rules and every filter's external rules.
// Within each source, longest-suffix match wins (standard V2Ray/Clash
// semantics), so a rule for `sub.example.com` takes precedence over
// a broader rule for `example.com` *within the same source*. Across
// sources, all matches are merged — a domain bound to both a static
// branch and an external filter ends up in both -dns ipsets.
func (m *DomainMatcher) Match(queryDomain string) ([]string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	qd := strings.ToLower(strings.TrimSuffix(queryDomain, "."))
	parts := strings.Split(qd, ".")

	var hits []string

	// Static: longest-suffix match.
	for i := 0; i < len(parts); i++ {
		candidate := strings.Join(parts[i:], ".")
		if names, ok := m.static[candidate]; ok {
			hits = append(hits, names...)
			break
		}
	}

	// External: longest-suffix match per filter, union across filters.
	for _, fr := range m.external {
		for i := 0; i < len(parts); i++ {
			candidate := strings.Join(parts[i:], ".")
			if names, ok := fr[candidate]; ok {
				hits = append(hits, names...)
				break
			}
		}
	}

	if len(hits) == 0 {
		return nil, false
	}
	return dedup(hits), true
}

// normalize lowercases keys, strips a leading "*." wildcard, and dedups
// the ipset slice for each domain.
func normalize(in map[string][]string) map[string][]string {
	out := make(map[string][]string, len(in))
	for domain, ipsetNames := range in {
		d := strings.ToLower(strings.TrimPrefix(domain, "*."))
		out[d] = dedup(ipsetNames)
	}
	return out
}

func dedup(s []string) []string {
	if len(s) <= 1 {
		return s
	}
	seen := make(map[string]struct{}, len(s))
	out := s[:0]
	for _, v := range s {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
