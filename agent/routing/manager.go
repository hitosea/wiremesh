package routing

import (
	"fmt"
	"log"
	"os/exec"
	"strings"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/dns"
	"github.com/wiremesh/agent/ipset"
)

// Manager orchestrates branch-based routing: ip rules, iptables mangle, ipset, DNS proxy.
type Manager struct {
	dnsProxy   *dns.Proxy
	syncer     *SourceSyncer
	lastConfig *api.RoutingConfig
}

func NewManager() *Manager {
	return &Manager{}
}

// Sync applies the routing configuration from the management platform.
func (m *Manager) Sync(cfg *api.RoutingConfig) error {
	if cfg == nil || !cfg.Enabled || len(cfg.Branches) == 0 {
		m.Cleanup()
		return nil
	}

	// 1. Clean old routing rules
	m.cleanIPRules()
	m.cleanMangleRules()

	// 2. Set up each branch
	domainRules := make(map[string]string) // domain -> ipset name
	nonDefaultIdx := 0

	for _, branch := range cfg.Branches {
		table := fmt.Sprintf("%d", branch.Mark)
		markHex := fmt.Sprintf("0x%x", branch.Mark)
		ipsetName := fmt.Sprintf("wm-branch-%d", branch.ID)

		// Create routing table and ip rule
		run("ip", "route", "replace", "default", "dev", branch.Tunnel, "table", table)

		if branch.IsDefault {
			// Default branch: lowest priority (32000), match unmarked traffic
			run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", "32000")
			// Mark all unmarked traffic from wm-wg0
			addMangleRule(fmt.Sprintf(
				"-A PREROUTING -i wm-wg0 -m mark --mark 0 -j MARK --set-mark %s -m comment --comment wm-branch-default",
				markHex,
			))
		} else {
			// Non-default branch: higher priority than default (must be < 32000 to match first)
			priority := fmt.Sprintf("%d", 30000+nonDefaultIdx)
			nonDefaultIdx++
			run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", priority)

			// IP/CIDR rules: iptables mangle PREROUTING
			for _, cidr := range branch.IPRules {
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 -d %s -j MARK --set-mark %s -m comment --comment wm-branch-%d",
					cidr, markHex, branch.ID,
				))
			}

			// Domain rules: create ipset + iptables match
			if len(branch.DomainRules) > 0 {
				if err := ipset.Create(ipsetName); err != nil {
					log.Printf("[routing] Failed to create ipset %s: %v (skipping ipset-based rules for branch %d)", ipsetName, err, branch.ID)
				} else {
					addMangleRule(fmt.Sprintf(
						"-A PREROUTING -i wm-wg0 -m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-branch-%d-dns",
						ipsetName, markHex, branch.ID,
					))
				}
				for _, domain := range branch.DomainRules {
					domainRules[domain] = ipsetName
				}
			}
		}
	}

	// 3. Start/update DNS proxy
	if len(domainRules) > 0 {
		if m.dnsProxy == nil {
			m.dnsProxy = dns.NewProxy(cfg.DNS.Listen, cfg.DNS.Upstream)
			m.dnsProxy.Start()
		}
		m.dnsProxy.UpdateRules(domainRules)
	} else if m.dnsProxy != nil {
		m.dnsProxy.Stop()
		m.dnsProxy = nil
	}

	// 4. Start/update external rule source syncer
	if m.syncer == nil {
		m.syncer = NewSourceSyncer(m)
	}
	m.syncer.UpdateSources(cfg.Branches)

	m.lastConfig = cfg
	log.Printf("[routing] Routing configured: %d branches", len(cfg.Branches))
	return nil
}

// Cleanup removes all routing rules and stops DNS proxy.
func (m *Manager) Cleanup() {
	m.cleanIPRules()
	m.cleanMangleRules()
	ipset.DestroyAllWireMesh()
	if m.dnsProxy != nil {
		m.dnsProxy.Stop()
		m.dnsProxy = nil
	}
	if m.syncer != nil {
		m.syncer.Stop()
		m.syncer = nil
	}
	log.Println("[routing] Routing cleaned up")
}

func (m *Manager) cleanIPRules() {
	for i := 41001; i <= 41100; i++ {
		table := fmt.Sprintf("%d", i)
		markHex := fmt.Sprintf("0x%x", i)
		exec.Command("ip", "rule", "del", "fwmark", markHex).CombinedOutput()
		exec.Command("ip", "route", "flush", "table", table).CombinedOutput()
	}
	exec.Command("ip", "rule", "del", "priority", "32000").CombinedOutput()
}

func (m *Manager) cleanMangleRules() {
	// List and remove all wm-branch-* and wm-xray-* mangle rules from PREROUTING and OUTPUT
	for _, chain := range []string{"PREROUTING", "OUTPUT"} {
		out, err := exec.Command("iptables", "-t", "mangle", "-S", chain).CombinedOutput()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if (strings.Contains(line, "wm-branch") || strings.Contains(line, "wm-xray")) && strings.HasPrefix(line, "-A ") {
				deleteRule := strings.Replace(line, "-A ", "-D ", 1)
				args := strings.Fields("-t mangle " + deleteRule)
				exec.Command("iptables", args...).CombinedOutput()
			}
		}
	}
}

// ReapplyIPRules re-applies IP rules for a branch after external source sync.
func (m *Manager) ReapplyIPRules(branchID int, ipRules []string) {
	if m.lastConfig == nil {
		return
	}
	for _, branch := range m.lastConfig.Branches {
		if branch.ID == branchID && !branch.IsDefault {
			markHex := fmt.Sprintf("0x%x", branch.Mark)
			// Remove old rules for this branch
			removeMangleRulesByComment(fmt.Sprintf("wm-branch-%d", branchID))
			// Re-add with new IP list
			for _, cidr := range ipRules {
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 -d %s -j MARK --set-mark %s -m comment --comment wm-branch-%d",
					cidr, markHex, branchID,
				))
			}
			break
		}
	}
}

func addMangleRule(rule string) {
	args := strings.Fields("-t mangle " + rule)
	out, err := exec.Command("iptables", args...).CombinedOutput()
	if err != nil {
		log.Printf("[routing] Error adding mangle rule: %s: %v: %s", rule, err, string(out))
	}
}

func removeMangleRulesByComment(comment string) {
	out, err := exec.Command("iptables", "-t", "mangle", "-S", "PREROUTING").CombinedOutput()
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, comment) && strings.HasPrefix(line, "-A ") {
			deleteRule := strings.Replace(line, "-A ", "-D ", 1)
			args := strings.Fields("-t mangle " + deleteRule)
			exec.Command("iptables", args...).CombinedOutput()
		}
	}
}

func run(args ...string) {
	out, err := exec.Command(args[0], args[1:]...).CombinedOutput()
	if err != nil && !strings.Contains(string(out), "File exists") {
		log.Printf("[routing] %s: %v: %s", strings.Join(args, " "), err, string(out))
	}
}
