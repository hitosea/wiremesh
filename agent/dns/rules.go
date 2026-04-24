package dns

import (
	"strings"
	"sync"
)

// DomainMatcher stores domain rules mapped to branch ipset names.
// A domain may map to multiple ipsets when the same filter is bound to
// several branches — each resolved IP must be added to all of them.
type DomainMatcher struct {
	mu    sync.RWMutex
	rules map[string][]string // domain -> ipset names
}

func NewDomainMatcher() *DomainMatcher {
	return &DomainMatcher{rules: make(map[string][]string)}
}

// SetRules replaces all rules. Each domain maps to a slice of branch ipset names.
func (m *DomainMatcher) SetRules(rules map[string][]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rules = make(map[string][]string, len(rules))
	for domain, ipsetNames := range rules {
		d := strings.ToLower(strings.TrimPrefix(domain, "*."))
		m.rules[d] = dedup(ipsetNames)
	}
}

// MergeRules adds rules without removing existing ones. When a domain already
// has ipset names registered, new names are unioned in (duplicates dropped).
func (m *DomainMatcher) MergeRules(rules map[string][]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for domain, ipsetNames := range rules {
		d := strings.ToLower(strings.TrimPrefix(domain, "*."))
		m.rules[d] = dedup(append(m.rules[d], ipsetNames...))
	}
}

// Match checks if a query domain matches any rule.
// Returns all matching ipset names (may be multiple) and true if matched.
func (m *DomainMatcher) Match(queryDomain string) ([]string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	qd := strings.ToLower(strings.TrimSuffix(queryDomain, "."))

	parts := strings.Split(qd, ".")
	for i := 0; i < len(parts); i++ {
		candidate := strings.Join(parts[i:], ".")
		if ipsetNames, ok := m.rules[candidate]; ok {
			return ipsetNames, true
		}
	}
	return nil, false
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
