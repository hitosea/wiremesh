package dns

import (
	"strings"
	"sync"
)

// DomainMatcher stores domain rules mapped to branch ipset names.
type DomainMatcher struct {
	mu    sync.RWMutex
	rules map[string]string // domain -> ipset name
}

func NewDomainMatcher() *DomainMatcher {
	return &DomainMatcher{rules: make(map[string]string)}
}

// SetRules replaces all rules. Each domain maps to a branch ipset name.
func (m *DomainMatcher) SetRules(rules map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rules = make(map[string]string, len(rules))
	for domain, ipsetName := range rules {
		d := strings.ToLower(strings.TrimPrefix(domain, "*."))
		m.rules[d] = ipsetName
	}
}

// MergeRules adds rules without removing existing ones.
func (m *DomainMatcher) MergeRules(rules map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for domain, ipsetName := range rules {
		d := strings.ToLower(strings.TrimPrefix(domain, "*."))
		m.rules[d] = ipsetName
	}
}

// Match checks if a query domain matches any rule.
// Returns the ipset name and true if matched.
func (m *DomainMatcher) Match(queryDomain string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	qd := strings.ToLower(strings.TrimSuffix(queryDomain, "."))

	parts := strings.Split(qd, ".")
	for i := 0; i < len(parts); i++ {
		candidate := strings.Join(parts[i:], ".")
		if ipsetName, ok := m.rules[candidate]; ok {
			return ipsetName, true
		}
	}
	return "", false
}
