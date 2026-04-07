package wg

import (
	"fmt"
	"log"
	"strings"

	"github.com/wiremesh/agent/api"
)

const (
	routeTableStart     = 100 // WG device routes: tables 101-199
	xrayRouteTableStart = 200 // Xray fwmark routes: tables 201-299
)

// SyncRouting applies per-device routing rules based on deviceRoutes.
// Each route has a type:
//   "entry" → source-based policy routing (ip rule from X lookup tableN)
//   "exit"  → destination-based route (ip route replace X dev tunN)
func SyncRouting(deviceRoutes []api.DeviceRoute) error {
	cleanRouting()

	if len(deviceRoutes) == 0 {
		return nil
	}

	entryIdx := 0
	for _, route := range deviceRoutes {
		switch route.Type {
		case "entry":
			tableNum := routeTableStart + entryIdx + 1 // 101, 102, ...
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
		table := fmt.Sprintf("%d", route.Mark) // use mark value as table number (201, 202, ...)
		markHex := fmt.Sprintf("0x%x", route.Mark)

		// Add route: default via tunnel in this table
		if _, err := Run("ip", "route", "replace", "default", "dev", route.Tunnel, "table", table); err != nil {
			log.Printf("[routing] Error adding xray route table %s: %v", table, err)
			continue
		}

		// Add rule: fwmark → lookup table
		if _, err := Run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", table); err != nil {
			if !strings.Contains(err.Error(), "File exists") {
				log.Printf("[routing] Error adding fwmark rule %s: %v", markHex, err)
				continue
			}
		}

		log.Printf("[routing] Xray: fwmark %s → %s (wm-xray-line-%d, table %s)",
			markHex, route.Tunnel, route.LineID, table)
	}

	log.Printf("[routing] Xray routing configured: %d lines", len(routes))
	return nil
}

func cleanRouting() {
	// Clean WG device routes (tables 101-199)
	for i := routeTableStart + 1; i <= routeTableStart+99; i++ {
		table := fmt.Sprintf("%d", i)
		_, err := RunSilent("ip", "rule", "del", "lookup", table, "priority", table)
		if err != nil {
			break
		}
		RunSilent("ip", "route", "flush", "table", table)
	}

	// Clean Xray fwmark routes (tables 201-299)
	for i := xrayRouteTableStart + 1; i <= xrayRouteTableStart+99; i++ {
		table := fmt.Sprintf("%d", i)
		markHex := fmt.Sprintf("0x%x", i)
		_, err := RunSilent("ip", "rule", "del", "fwmark", markHex, "lookup", table, "priority", table)
		if err != nil {
			break
		}
		RunSilent("ip", "route", "flush", "table", table)
	}

	// Clean legacy table 100
	RunSilent("ip", "rule", "del", "lookup", "100", "priority", "100")
	RunSilent("ip", "route", "flush", "table", "100")
}

// CleanupRouting is called during shutdown
func CleanupRouting() {
	cleanRouting()
	log.Println("[routing] Routing cleaned up")
}
