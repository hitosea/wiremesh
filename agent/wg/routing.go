package wg

import (
	"fmt"
	"log"
	"strings"

	"github.com/wiremesh/agent/api"
)

const (
	routeTable   = "100"
	rulePriority = "100"
)

// SyncRouting configures routing rules based on the node's role:
//
// Entry node (has peers): Policy routing so device subnet (10.0.0.0/24)
// traffic is forwarded through the tunnel instead of the default route.
//
// Exit node (has upstream tunnel, no peers): Return route so response
// packets destined for the device subnet go back through the tunnel,
// not to the local wm-wg0 interface.
func SyncRouting(node api.NodeConfig, tunnels []api.TunnelInterface, hasPeers bool) error {
	cleanRouting()

	if len(tunnels) == 0 {
		return nil
	}

	deviceSubnet := subnetFromAddress(node.WgAddress)
	if deviceSubnet == "" {
		return fmt.Errorf("cannot determine device subnet from %s", node.WgAddress)
	}

	if hasPeers {
		return syncEntryRouting(deviceSubnet, tunnels)
	}
	return syncExitRouting(deviceSubnet, tunnels)
}

// syncEntryRouting: device subnet → tunnel (policy routing via table 100)
func syncEntryRouting(deviceSubnet string, tunnels []api.TunnelInterface) error {
	// Find downstream tunnel (role "from")
	var downstreamIface string
	for _, t := range tunnels {
		if t.Role == "from" {
			downstreamIface = t.Name
			break
		}
	}
	if downstreamIface == "" {
		return nil
	}

	log.Printf("[routing] Entry node: %s → %s (policy routing)", deviceSubnet, downstreamIface)

	if _, err := Run("ip", "route", "replace", "default", "dev", downstreamIface, "table", routeTable); err != nil {
		return fmt.Errorf("add route table: %w", err)
	}

	if _, err := Run("ip", "rule", "add", "from", deviceSubnet, "lookup", routeTable, "priority", rulePriority); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			return fmt.Errorf("add ip rule: %w", err)
		}
	}

	log.Printf("[routing] Entry routing configured: from %s lookup table %s via %s", deviceSubnet, routeTable, downstreamIface)
	return nil
}

// syncExitRouting: return packets for device subnet → tunnel (not local wm-wg0)
// Without this, the exit node routes 10.0.0.x packets to its local wm-wg0
// (because wm-wg0 has an address in 10.0.0.0/24), instead of sending them
// back through the tunnel to the entry node.
func syncExitRouting(deviceSubnet string, tunnels []api.TunnelInterface) error {
	// Find upstream tunnel (role "to")
	var upstreamIface string
	for _, t := range tunnels {
		if t.Role == "to" {
			upstreamIface = t.Name
			break
		}
	}
	if upstreamIface == "" {
		return nil
	}

	log.Printf("[routing] Exit node: %s return via %s", deviceSubnet, upstreamIface)

	// Replace the device subnet route: point to tunnel instead of wm-wg0
	if _, err := Run("ip", "route", "replace", deviceSubnet, "dev", upstreamIface); err != nil {
		return fmt.Errorf("replace device subnet route: %w", err)
	}

	log.Printf("[routing] Exit routing configured: %s via %s", deviceSubnet, upstreamIface)
	return nil
}

func cleanRouting() {
	// Clean policy routing (entry node)
	for i := 0; i < 10; i++ {
		_, err := RunSilent("ip", "rule", "del", "lookup", routeTable, "priority", rulePriority)
		if err != nil {
			break
		}
	}
	RunSilent("ip", "route", "flush", "table", routeTable)
}

// CleanupRouting is called during shutdown
func CleanupRouting() {
	cleanRouting()
	log.Println("[routing] Policy routing cleaned up")
}

func subnetFromAddress(addr string) string {
	parts := strings.Split(addr, "/")
	if len(parts) != 2 {
		return ""
	}
	ipParts := strings.Split(parts[0], ".")
	if len(ipParts) != 4 {
		return ""
	}
	return fmt.Sprintf("%s.%s.%s.0/%s", ipParts[0], ipParts[1], ipParts[2], parts[1])
}
