package wg

import (
	"fmt"
	"log"
	"strings"

	"github.com/wiremesh/agent/api"
)

// Routing table/priority constants.
// Source of truth: src/lib/routing-constants.ts — keep in sync.
const (
	routeTableStart     = 20001 // WG device routes: tables 20001-20999
	routeTableEnd       = 20999
	relayTableStart     = 21001 // Relay forwarding routes: tables 21001-21999
	relayTableEnd       = 21999
	xrayRouteTableStart = 31001 // Xray fwmark routes: tables 31001-31999
	xrayRouteTableEnd   = 31999
)

// SyncRouting applies per-device routing rules based on deviceRoutes.
// Each route has a type:
//   "entry" → source-based policy routing (ip rule from X lookup tableN)
//   "exit"  → destination-based route (ip route replace X dev tunN)
//   "relay" → iif-based forwarding (ip rule iif tunX lookup tableN → tunY)
func SyncRouting(deviceRoutes []api.DeviceRoute) error {
	cleanRouting()

	if len(deviceRoutes) == 0 {
		return nil
	}

	entryIdx := 0
	relayIdx := 0
	for _, route := range deviceRoutes {
		switch route.Type {
		case "entry":
			tableNum := routeTableStart + entryIdx // 20001, 20002, ...
			table := fmt.Sprintf("%d", tableNum)

			if _, err := Run("ip", "route", "replace", "default", "dev", route.Tunnel, "table", table); err != nil {
				log.Printf("[routing] Error adding route table %s: %v", table, err)
				continue
			}
			if _, err := Run("ip", "rule", "add", "from", route.Destination, "lookup", table, "priority", table); err != nil {
				if !strings.Contains(err.Error(), "File exists") {
					log.Printf("[routing] Error adding rule for %s: %v", route.Destination, err)
					continue
				}
			}
			log.Printf("[routing] Entry: %s → %s (table %s)", route.Destination, route.Tunnel, table)
			entryIdx++

		case "exit":
			if _, err := Run("ip", "route", "replace", route.Destination, "dev", route.Tunnel); err != nil {
				log.Printf("[routing] Error adding return route %s → %s: %v", route.Destination, route.Tunnel, err)
				continue
			}
			log.Printf("[routing] Exit: %s → %s", route.Destination, route.Tunnel)

		case "relay":
			// Destination = upstream iface (where traffic comes in)
			// Tunnel = downstream iface (where traffic goes out)
			tableNum := relayTableStart + relayIdx // 21001, 21002, ...
			table := fmt.Sprintf("%d", tableNum)

			if _, err := Run("ip", "route", "replace", "default", "dev", route.Tunnel, "table", table); err != nil {
				log.Printf("[routing] Error adding relay route table %s: %v", table, err)
				continue
			}
			if _, err := Run("ip", "rule", "add", "iif", route.Destination, "lookup", table, "priority", table); err != nil {
				if !strings.Contains(err.Error(), "File exists") {
					log.Printf("[routing] Error adding relay rule iif %s: %v", route.Destination, err)
					continue
				}
			}
			log.Printf("[routing] Relay: iif %s → %s (table %s)", route.Destination, route.Tunnel, table)
			relayIdx++
		}
	}

	log.Printf("[routing] Routing configured: %d routes", len(deviceRoutes))
	return nil
}

// SyncXrayRouting applies fwmark-based routing for Xray traffic.
// Each XrayLineRoute has a mark value — packets marked by Xray are routed
// to the correct tunnel via policy routing.
func SyncXrayRouting(routes []api.XrayLineRoute) error {
	if len(routes) == 0 {
		return nil
	}

	for _, route := range routes {
		table := fmt.Sprintf("%d", route.Mark) // use mark value as table number
		markHex := fmt.Sprintf("0x%x", route.Mark)
		priority := table // unified: priority == table number

		// Add route: default via tunnel in this table
		if _, err := Run("ip", "route", "replace", "default", "dev", route.Tunnel, "table", table); err != nil {
			log.Printf("[routing] Error adding xray route table %s: %v", table, err)
			continue
		}

		// Add rule: fwmark → lookup table (priority must be < 32766 to take effect before main table)
		if _, err := Run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", priority); err != nil {
			if !strings.Contains(err.Error(), "File exists") {
				log.Printf("[routing] Error adding fwmark rule %s: %v", markHex, err)
				continue
			}
		}

		log.Printf("[routing] Xray: fwmark %s → %s (wm-xray-line-%d, table %s, priority %s)",
			markHex, route.Tunnel, route.LineID, table, priority)
	}

	log.Printf("[routing] Xray routing configured: %d lines", len(routes))
	return nil
}

func cleanRouting() {
	// Clean WG device routes (tables 20001-20999)
	// Source of truth: src/lib/routing-constants.ts
	for i := routeTableStart; i <= routeTableEnd; i++ {
		table := fmt.Sprintf("%d", i)
		_, err := RunSilent("ip", "rule", "del", "lookup", table, "priority", table)
		if err != nil {
			break
		}
		RunSilent("ip", "route", "flush", "table", table)
	}

	// Clean relay routes (tables 21001-21999)
	// Source of truth: src/lib/routing-constants.ts
	for i := relayTableStart; i <= relayTableEnd; i++ {
		table := fmt.Sprintf("%d", i)
		_, err := RunSilent("ip", "rule", "del", "lookup", table, "priority", table)
		if err != nil {
			break
		}
		RunSilent("ip", "route", "flush", "table", table)
	}

	// Clean Xray fwmark routes (31001-31999)
	// Source of truth: src/lib/routing-constants.ts
	for i := xrayRouteTableStart; i <= xrayRouteTableEnd; i++ {
		table := fmt.Sprintf("%d", i)
		markHex := fmt.Sprintf("0x%x", i)
		_, err := RunSilent("ip", "rule", "del", "fwmark", markHex, "lookup", table)
		if err != nil {
			break
		}
		RunSilent("ip", "route", "flush", "table", table)
	}
}

// CleanupRouting is called during shutdown
func CleanupRouting() {
	cleanRouting()
	log.Println("[routing] Routing cleaned up")
}
