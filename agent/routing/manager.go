package routing

import (
	"fmt"
	"log"
	"os/exec"
	"strings"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/dns"
	"github.com/wiremesh/agent/ipset"
	"github.com/wiremesh/agent/wg"
)

// Manager orchestrates branch-based routing: ip rules, iptables mangle, ipset, DNS proxy.
//
// Per-branch ipset model (for non-default branches):
//   - wm-line-src-{id}  hash:net   source scoping: device IPs on this line
//   - wm-branch-{id}-cidr  hash:net   static + external-source IPs (bulk swapped)
//   - wm-branch-{id}-dns   hash:ip   DNS-resolved IPs (TTL-based, incrementally added)
//
// Mangle rules are generated once at Sync() and never modified by the SourceSyncer.
// Filter updates only mutate ipset membership, not iptables rules.
type Manager struct {
	dnsProxy   *dns.Proxy
	syncer     *SourceSyncer
	client     *api.Client
	lastConfig *api.RoutingConfig
}

func NewManager(client *api.Client) *Manager {
	return &Manager{client: client}
}

// Sync applies the routing configuration from the management platform.
// xrayRoutes, when non-empty, generates OUTPUT chain rules per-line
// so Xray traffic gets branch-based split tunneling via iptables.
func (m *Manager) Sync(cfg *api.RoutingConfig, xrayRoutes []api.XrayLineRoute) error {
	if cfg == nil || !cfg.Enabled {
		m.Cleanup()
		return nil
	}

	// Manage DNS proxy lifecycle based on cfg.DNS.Listen being set.
	// DNS proxy runs even for nodes with no multi-branch lines — it provides
	// DoT-based DNS forwarding for WG clients to prevent GFW poisoning.
	// BindDevice (e.g. "wm-tun1") forces upstream queries through a tunnel.
	if cfg.DNS.Listen != "" {
		if m.dnsProxy == nil {
			m.dnsProxy = dns.NewProxyWithBind(cfg.DNS.Listen, cfg.DNS.Upstream, cfg.DNS.BindDevice)
			m.dnsProxy.Start()
		}
	} else if m.dnsProxy != nil {
		m.dnsProxy.Stop()
		m.dnsProxy = nil
	}

	if len(cfg.Branches) == 0 {
		// No multi-branch lines: no branch routing needed. DNS proxy stays up
		// (plain forwarder mode). Clean any leftover branch rules.
		m.cleanIPRules()
		m.cleanMangleRules()
		if m.dnsProxy != nil {
			m.dnsProxy.UpdateRules(nil)
		}
		m.lastConfig = cfg
		return nil
	}

	// 1. Clean old routing rules
	m.cleanIPRules()
	m.cleanMangleRules()

	// 2. Create per-line source ipsets (all branches of a line share device IPs)
	srcIpsets := make(map[string]bool) // ipset name → created successfully
	for _, branch := range cfg.Branches {
		if len(branch.DeviceIPs) == 0 {
			continue
		}
		srcName := fmt.Sprintf("wm-line-src-%d", branch.ID)
		if _, exists := srcIpsets[srcName]; exists {
			continue
		}
		if err := ipset.CreateHash(srcName, "net"); err != nil {
			log.Printf("[routing] Failed to create source ipset %s: %v", srcName, err)
			srcIpsets[srcName] = false
			continue
		}
		for _, ip := range branch.DeviceIPs {
			ipset.Add(srcName, ip, 0)
		}
		srcIpsets[srcName] = true
	}

	// Helper: build "-m set --match-set <name> src " clause if source ipset exists
	srcMatchFor := func(branch api.RoutingBranch) string {
		if len(branch.DeviceIPs) == 0 {
			return ""
		}
		srcName := fmt.Sprintf("wm-line-src-%d", branch.ID)
		if ok := srcIpsets[srcName]; !ok {
			return ""
		}
		return fmt.Sprintf("-m set --match-set %s src ", srcName)
	}

	// 3. Set up each branch
	domainRules := make(map[string]string) // domain -> ipset name (the -dns ipset)

	for _, branch := range cfg.Branches {
		table := fmt.Sprintf("%d", branch.Mark)
		markHex := markHex(branch.Mark)
		srcMatch := srcMatchFor(branch)

		// Use wg.AddDefaultRoute so external interfaces (eth0) pick up the
		// system's default gateway — essential for nodes behind NAT where
		// "dev eth0 scope link" alone can't reach off-subnet destinations.
		if err := wg.AddDefaultRoute(branch.Tunnel, table); err != nil {
			log.Printf("[routing] Failed to add default route for branch %d via %s: %v", branch.ID, branch.Tunnel, err)
		}

		if branch.IsDefault {
			run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", "32000")
			if srcMatch != "" {
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 %s-m mark --mark 0 -j MARK --set-mark %s -m comment --comment wm-branch-default-%d",
					srcMatch, markHex, branch.ID,
				))
			} else {
				addMangleRule(fmt.Sprintf(
					"-A PREROUTING -i wm-wg0 -m mark --mark 0 -j MARK --set-mark %s -m comment --comment wm-branch-default",
					markHex,
				))
			}
			continue
		}

		// Non-default branch: dual-ipset model.
		//   *-cidr  carries static IPs (from branch.IPRules) and external-source
		//           IPs (populated later by SourceSyncer via atomic swap).
		//   *-dns   carries DNS-resolved IPs, populated incrementally by DNS proxy
		//           with TTL-based expiry.
		cidrSet := fmt.Sprintf("wm-branch-%d-cidr", branch.ID)
		dnsSet := fmt.Sprintf("wm-branch-%d-dns", branch.ID)

		run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", table)

		if err := ipset.CreateHash(cidrSet, "net"); err != nil {
			log.Printf("[routing] Failed to create ipset %s: %v", cidrSet, err)
		} else {
			for _, cidr := range branch.IPRules {
				if err := ipset.Add(cidrSet, cidr, 0); err != nil {
					log.Printf("[routing] Failed to add static rule %s to %s: %v", cidr, cidrSet, err)
				}
			}
			addMangleRule(fmt.Sprintf(
				"-A PREROUTING -i wm-wg0 %s-m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-branch-%d-cidr",
				srcMatch, cidrSet, markHex, branch.ID,
			))
		}

		if err := ipset.Create(dnsSet); err != nil {
			log.Printf("[routing] Failed to create ipset %s: %v", dnsSet, err)
		} else {
			addMangleRule(fmt.Sprintf(
				"-A PREROUTING -i wm-wg0 %s-m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-branch-%d-dns",
				srcMatch, dnsSet, markHex, branch.ID,
			))
		}

		for _, domain := range branch.DomainRules {
			domainRules[domain] = dnsSet
		}
	}

	// 2b. OUTPUT chain rules for Xray split tunneling
	// Each Xray line has its own default mark. For lines with branch routing,
	// OUTPUT rules remark the default mark to branch marks based on ipset matching.
	// Each branch contributes one rule per ipset (cidr + dns), mirroring the
	// PREROUTING model — so both static/external IPs and DNS-resolved IPs trigger
	// the branch remark for Xray traffic.
	if len(xrayRoutes) > 0 {
		// Determine which branch IDs exist in the routing config so we only
		// emit rules for branches whose ipsets were created above.
		branchExists := make(map[int]bool)
		for _, b := range cfg.Branches {
			if !b.IsDefault {
				branchExists[b.ID] = true
			}
		}

		for _, route := range xrayRoutes {
			if len(route.Branches) <= 1 {
				continue // no split tunneling for single-branch lines
			}
			// Use route.Mark (per-line Xray mark, 31001+ range) for matching.
			// Xray sets sockopt.mark to this value. OUTPUT rules remark to branch marks
			// when destination matches a filter ipset.
			perLineMarkHex := markHex(route.Mark)
			for _, branch := range route.Branches {
				if branch.IsDefault {
					continue
				}
				branchID := findBranchIDByMark(cfg.Branches, branch.Mark)
				if branchID == 0 || !branchExists[branchID] {
					continue
				}
				cidrSet := fmt.Sprintf("wm-branch-%d-cidr", branchID)
				dnsSet := fmt.Sprintf("wm-branch-%d-dns", branchID)
				branchMarkHex := markHex(branch.Mark)
				addMangleRule(fmt.Sprintf(
					"-A OUTPUT -m mark --mark %s -m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-xray-line-%d-cidr",
					perLineMarkHex, cidrSet, branchMarkHex, route.LineID,
				))
				addMangleRule(fmt.Sprintf(
					"-A OUTPUT -m mark --mark %s -m set --match-set %s dst -j MARK --set-mark %s -m comment --comment wm-xray-line-%d-dns",
					perLineMarkHex, dnsSet, branchMarkHex, route.LineID,
				))
			}
		}

		// MASQUERADE for all Xray traffic going through tunnels
		// (Xray packets have eth0 source IP; needs conversion to tunnel IP)
		// This must be added for ANY node with Xray entry role, not just multi-branch
		addNatRule("-A POSTROUTING -o wm-tun+ -j MASQUERADE -m comment --comment wm-xray-masq")
	}

	// MASQUERADE for SOCKS5 traffic going through tunnels (independent of Xray)
	addNatRule("-A POSTROUTING -o wm-tun+ -j MASQUERADE -m comment --comment wm-socks5-masq")

	// 3. Update DNS proxy domain rules (proxy lifecycle is already managed above
	// based on cfg.DNS.Listen, independent of domain rules)
	if m.dnsProxy != nil {
		m.dnsProxy.UpdateRules(domainRules)
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

// findBranchIDByMark returns the branch ID in cfg.Branches matching the given
// fwmark, or 0 if none found. Used to correlate Xray branch marks (per-line
// view) with routing-config branch IDs (per-node view).
func findBranchIDByMark(branches []api.RoutingBranch, mark int) int {
	for _, b := range branches {
		if b.Mark == mark {
			return b.ID
		}
	}
	return 0
}

// StaticIPsForBranch returns the static IP rules declared in the routing
// config for a given branch. These come from manually-entered filter.rules
// (not external sourceUrl lists). Used by SourceSyncer when rebuilding the
// branch's -cidr ipset.
func (m *Manager) StaticIPsForBranch(branchID int) []string {
	if m.lastConfig == nil {
		return nil
	}
	for _, b := range m.lastConfig.Branches {
		if b.ID == branchID {
			return append([]string(nil), b.IPRules...)
		}
	}
	return nil
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

func run(args ...string) {
	out, err := exec.Command(args[0], args[1:]...).CombinedOutput()
	if err != nil && !strings.Contains(string(out), "File exists") {
		log.Printf("[routing] %s: %v: %s", strings.Join(args, " "), err, string(out))
	}
}
