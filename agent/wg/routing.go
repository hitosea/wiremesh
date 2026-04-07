package wg

import (
	"fmt"
	"log"
	"strings"

	"github.com/wiremesh/agent/api"
)

const routeTableStart = 100

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

func cleanRouting() {
	for i := routeTableStart + 1; i <= routeTableStart+100; i++ {
		table := fmt.Sprintf("%d", i)
		_, err := RunSilent("ip", "rule", "del", "lookup", table, "priority", table)
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
