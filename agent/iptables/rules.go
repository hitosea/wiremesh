package iptables

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

func SyncRules(desiredRules []string) error {
	existingRules, err := listWireMeshRules()
	if err != nil {
		log.Printf("[iptables] Warning: failed to list existing rules: %v", err)
	}

	desiredSet := make(map[string]bool)
	for _, rule := range desiredRules {
		desiredSet[strings.TrimSpace(rule)] = true
	}

	for _, rule := range existingRules {
		if !desiredSet[strings.TrimSpace(rule)] {
			log.Printf("[iptables] Removing: iptables %s", rule)
			removeRule(rule)
		}
	}

	existingSet := make(map[string]bool)
	for _, rule := range existingRules {
		existingSet[strings.TrimSpace(rule)] = true
	}

	for _, rule := range desiredRules {
		if !existingSet[strings.TrimSpace(rule)] {
			log.Printf("[iptables] Adding: iptables %s", rule)
			if err := addRule(rule); err != nil {
				log.Printf("[iptables] Error adding rule: %v", err)
			}
		}
	}
	return nil
}

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

func listWireMeshRules() ([]string, error) {
	var allRules []string
	for _, args := range [][]string{
		{"-t", "filter", "-S", "FORWARD"},
		{"-t", "nat", "-S", "POSTROUTING"},
	} {
		output, err := exec.Command("iptables", args...).CombinedOutput()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(output), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "wm-") && strings.HasPrefix(line, "-A ") {
				allRules = append(allRules, line)
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
	deleteRule := strings.Replace(rule, "-A ", "-D ", 1)
	args := strings.Fields(deleteRule)
	exec.Command("iptables", args...).CombinedOutput()
}
