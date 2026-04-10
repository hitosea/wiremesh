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
// xrayRoutes, when non-empty, generates OUTPUT chain rules per-line
// so Xray traffic gets branch-based split tunneling via iptables.
func (m *Manager) Sync(cfg *api.RoutingConfig, xrayRoutes []api.XrayLineRoute) error {
	if cfg == nil || !cfg.Enabled || len(cfg.Branches) == 0 {
		m.Cleanup()
		return nil
	}

	// 1. Clean old routing rules
	m.cleanIPRules()
	m.cleanMangleRules()

	// 2. Set up each branch
	domainRules := make(map[string]string) // domain -> ipset name

	for _, branch := range cfg.Branches {
		table := fmt.Sprintf("%d", branch.Mark)
		markHex := markHex(branch.Mark)
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
			// Non-default branch: priority == table number (both from branch mark, < 32000)
			run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", table)

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

	// 2b. OUTPUT chain rules for Xray split tunneling
	// Each Xray line has its own default mark. For lines with branch routing,
	// OUTPUT rules remark the default mark to branch marks based on ipset matching.
	// This works because Xray uses UseIP + DNS proxy, so ipsets are populated.
	if len(xrayRoutes) > 0 {
		// Build mark → ipset name mapping from routing config branches
		markToIpset := make(map[int]string)
		for _, b := range cfg.Branches {
			if !b.IsDefault && len(b.DomainRules) > 0 {
				markToIpset[b.Mark] = fmt.Sprintf("wm-branch-%d", b.ID)
			}
		}

		for _, route := range xrayRoutes {
			if len(route.Branches) <= 1 {
				continue // no split tunneling for single-branch lines
			}
			var defaultMarkHex string
			for _, branch := range route.Branches {
				if branch.IsDefault {
					defaultMarkHex = markHex(branch.Mark)
					break
				}
			}
			if defaultMarkHex == "" {
				continue
			}
			for _, branch := range route.Branches {
				if branch.IsDefault {
					continue
				}
				if ipsetName, ok := markToIpset[branch.Mark]; ok {
					addMangleRule(fmt.Sprintf(
						"-A OUTPUT -m mark --mark %s -m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-xray-line-%d",
						defaultMarkHex, ipsetName, markHex(branch.Mark), route.LineID,
					))
				}
			}
		}

		// MASQUERADE for all Xray traffic going through tunnels
		// (Xray packets have eth0 source IP; needs conversion to tunnel IP)
		// This must be added for ANY node with Xray entry role, not just multi-branch
		addNatRule("-A POSTROUTING -o wm-tun+ -j MASQUERADE -m comment --comment wm-xray-masq")
	}

	// MASQUERADE for SOCKS5 traffic going through tunnels (independent of Xray)
	addNatRule("-A POSTROUTING -o wm-tun+ -j MASQUERADE -m comment --comment wm-socks5-masq")

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
	m.cleanNatRules()
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
	// Clean branch fwmark rules (30001-30999)
	// Source of truth: src/lib/routing-constants.ts
	for i := 30001; i <= 30999; i++ {
		table := fmt.Sprintf("%d", i)
		markHex := fmt.Sprintf("0x%x", i)
		if _, err := exec.Command("ip", "rule", "del", "fwmark", markHex).CombinedOutput(); err != nil {
			break // no more rules — stop early
		}
		exec.Command("ip", "route", "flush", "table", table).CombinedOutput()
	}
	exec.Command("ip", "rule", "del", "priority", "32000").CombinedOutput()
}

func (m *Manager) cleanMangleRules() {
	cleanIptablesRules("mangle", []string{"PREROUTING", "OUTPUT"}, "wm-branch", "wm-xray")
}

// ReapplyIPRules re-applies IP rules for a branch after external source sync.
func (m *Manager) ReapplyIPRules(branchID int, ipRules []string) {
	if m.lastConfig == nil {
		return
	}
	for _, branch := range m.lastConfig.Branches {
		if branch.ID == branchID && !branch.IsDefault {
			markHex := markHex(branch.Mark)
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

func markHex(mark int) string { return fmt.Sprintf("0x%x", mark) }

func addIptablesRule(table, rule string) {
	args := strings.Fields("-t " + table + " " + rule)
	out, err := exec.Command("iptables", args...).CombinedOutput()
	if err != nil && !strings.Contains(string(out), "already exists") {
		log.Printf("[routing] Error adding %s rule: %s: %v: %s", table, rule, err, string(out))
	}
}

func addMangleRule(rule string) { addIptablesRule("mangle", rule) }
func addNatRule(rule string)    { addIptablesRule("nat", rule) }

func (m *Manager) cleanNatRules() {
	cleanIptablesRules("nat", []string{"POSTROUTING"}, "wm-xray", "wm-socks5")
}

// cleanIptablesRules removes rules containing any of the given comment
// prefixes from the specified table and chains.
func cleanIptablesRules(table string, chains []string, commentPrefixes ...string) {
	for _, chain := range chains {
		out, err := exec.Command("iptables", "-t", table, "-S", chain).CombinedOutput()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "-A ") {
				continue
			}
			for _, prefix := range commentPrefixes {
				if strings.Contains(line, prefix) {
					deleteRule := strings.Replace(line, "-A ", "-D ", 1)
					args := strings.Fields("-t " + table + " " + deleteRule)
					exec.Command("iptables", args...).CombinedOutput()
					break
				}
			}
		}
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
