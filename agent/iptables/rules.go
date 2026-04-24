package iptables

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// SyncRules applies the desired iptables rules and removes stale ones.
// Rules are identified by "wm-" in their comment tags.
// Desired rules come in the format from the management platform:
//   "-A FORWARD -i wm-wg0 -o wm-tun1 -m comment --comment wm-line-1 -j ACCEPT"
//   "-t nat -A POSTROUTING -s 10.0.0.0/8 -o eth0 -m comment --comment wm-line-1 -j MASQUERADE"
func SyncRules(desiredRules []string) error {
	// 1. List all existing WireMesh rules (normalized with table prefix)
	existingRules, err := listWireMeshRules()
	if err != nil {
		log.Printf("[iptables] Warning: failed to list existing rules: %v", err)
	}

	// 2. Build sets for comparison (use normalized form)
	desiredSet := make(map[string]bool)
	for _, rule := range desiredRules {
		desiredSet[normalizeRule(rule)] = true
	}

	existingSet := make(map[string]bool)
	for _, rule := range existingRules {
		existingSet[normalizeRule(rule)] = true
	}

	// 3. Remove rules not in desired set
	for _, rule := range existingRules {
		if !desiredSet[normalizeRule(rule)] {
			log.Printf("[iptables] Removing: %s", rule)
			removeRule(rule)
		}
	}

	// 4. Add rules not in existing set
	for _, rule := range desiredRules {
		if !existingSet[normalizeRule(rule)] {
			log.Printf("[iptables] Adding: %s", rule)
			if err := addRule(rule); err != nil {
				log.Printf("[iptables] Error adding rule: %v", err)
			}
		}
	}
	return nil
}

// RemoveAllWireMeshRules removes all iptables rules with "wm-" comments
func RemoveAllWireMeshRules() error {
	rules, err := listWireMeshRules()
	if err != nil {
		return err
	}
	for _, rule := range rules {
		removeRule(rule)
	}
	return nil
}

// listWireMeshRules returns all wm- tagged rules in normalized format.
// Scope is limited to filter/FORWARD and nat/POSTROUTING — the chains that
// the management platform's iptablesRules list actually drives. Mangle
// PREROUTING (branch fwmark rules) is managed by routing.Manager, including
// source-synced CIDRs from external filter URLs, so SyncRules must not touch
// it or it would wipe those rules every config sync.
func listWireMeshRules() ([]string, error) {
	var allRules []string

	// filter table FORWARD chain
	if output, err := exec.Command("iptables", "-t", "filter", "-S", "FORWARD").CombinedOutput(); err == nil {
		for _, line := range strings.Split(string(output), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "wm-") && strings.HasPrefix(line, "-A ") {
				allRules = append(allRules, line)
			}
		}
	}

	// nat table POSTROUTING chain — prefix with "-t nat" for correct matching
	if output, err := exec.Command("iptables", "-t", "nat", "-S", "POSTROUTING").CombinedOutput(); err == nil {
		for _, line := range strings.Split(string(output), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "wm-") && strings.HasPrefix(line, "-A ") {
				allRules = append(allRules, "-t nat "+line)
			}
		}
	}

	return allRules, nil
}

func addRule(rule string) error {
	args := strings.Fields(rule)
	output, err := exec.Command("iptables", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("iptables %s: %w: %s", rule, err, string(output))
	}
	return nil
}

func removeRule(rule string) {
	// Convert -A to -D for deletion
	deleteRule := strings.Replace(rule, "-A ", "-D ", 1)
	args := strings.Fields(deleteRule)
	exec.Command("iptables", args...).CombinedOutput()
}

func normalizeRule(rule string) string {
	return strings.TrimSpace(rule)
}
