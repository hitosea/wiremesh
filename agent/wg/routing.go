package wg

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"

	"github.com/wiremesh/agent/api"
)

var (
	defaultGateway     string
	defaultGatewayOnce sync.Once
)

// getDefaultGateway returns the system default gateway IP.
// Cached after first call since the gateway doesn't change during runtime.
func getDefaultGateway() string {
	defaultGatewayOnce.Do(func() {
		out, err := exec.Command("ip", "route", "show", "default").CombinedOutput()
		if err != nil {
			log.Printf("[routing] Warning: cannot get default gateway: %v", err)
			return
		}
		// Parse "default via 172.17.63.253 dev eth0 ..."
		fields := strings.Fields(strings.TrimSpace(string(out)))
		for i, f := range fields {
			if f == "via" && i+1 < len(fields) {
				defaultGateway = fields[i+1]
				break
			}
		}
		if defaultGateway != "" {
			log.Printf("[routing] Default gateway: %s", defaultGateway)
		}
	})
	return defaultGateway
}

// AddDefaultRoute adds a default route in the given table.
// For wm-* tunnel interfaces: "ip route replace default dev <iface> table <table>"
// For external interfaces (eth0 etc.): adds "via <gateway>" to ensure proper
// routing on nodes behind NAT (e.g. cloud VMs where eth0 is a private IP and
// non-LAN destinations require the gateway).
func AddDefaultRoute(iface, table string) error {
	if strings.HasPrefix(iface, "wm-") {
		_, err := Run("ip", "route", "replace", "default", "dev", iface, "table", table)
		return err
	}
	// External interface — need gateway
	gw := getDefaultGateway()
	if gw == "" {
		log.Printf("[routing] Warning: no default gateway found, route via %s may not work", iface)
		_, err := Run("ip", "route", "replace", "default", "dev", iface, "table", table)
		return err
	}
	_, err := Run("ip", "route", "replace", "default", "via", gw, "dev", iface, "table", table)
	return err
}

// Routing table/priority constants.
// Source of truth: src/lib/routing-constants.ts — keep in sync.
const (
	routeTableStart     = 20001 // WG device routes: tables 20001-20999
	routeTableEnd       = 20999
	relayTableStart     = 21001 // Relay forwarding routes: tables 21001-21999
	relayTableEnd       = 21999
	xrayRouteTableStart   = 31001 // Xray fwmark routes: tables 31001-31999
	xrayRouteTableEnd     = 31999
	socks5RouteTableStart = 32001 // SOCKS5 fwmark routes: tables 32001-32999
	socks5RouteTableEnd   = 32999
)

// SyncRouting applies per-device routing rules based on deviceRoutes.
// Each route has a type:
//   "entry" → source-based policy routing (ip rule from X lookup tableN)
//   "exit"  → destination-based route (ip route replace X dev tunN)
//   "relay" → iif-based forwarding (ip rule iif tunX lookup tableN → tunY)
func SyncRouting(deviceRoutes []api.DeviceRoute) error {
	cleanPolicyRange(routeTableStart, routeTableEnd, false)
	cleanPolicyRange(relayTableStart, relayTableEnd, false)

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

			if err := AddDefaultRoute(route.Tunnel, table); err != nil {
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
			// Forward: upstream → downstream
			fwdTable := fmt.Sprintf("%d", relayTableStart+relayIdx*2)
			if err := addIifRoute(route.Destination, route.Tunnel, fwdTable, "Relay"); err != nil {
				continue
			}
			// Return: downstream → upstream
			retTable := fmt.Sprintf("%d", relayTableStart+relayIdx*2+1)
			addIifRoute(route.Tunnel, route.Destination, retTable, "Relay return")
			relayIdx++
		}
	}

	log.Printf("[routing] Routing configured: %d routes", len(deviceRoutes))
	return nil
}

// addIifRoute sets up a policy route: packets arriving on inIface are routed to outIface via the given table.
func addIifRoute(inIface, outIface, table, label string) error {
	if err := AddDefaultRoute(outIface, table); err != nil {
		log.Printf("[routing] Error adding %s route table %s: %v", label, table, err)
		return err
	}
	if _, err := Run("ip", "rule", "add", "iif", inIface, "lookup", table, "priority", table); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			log.Printf("[routing] Error adding %s rule iif %s: %v", label, inIface, err)
			return err
		}
	}
	log.Printf("[routing] %s: iif %s → %s (table %s)", label, inIface, outIface, table)
	return nil
}

// SyncXrayRouting applies fwmark-based routing for Xray traffic.
// Each XrayInbound has a mark value — packets marked by Xray are routed
// to the correct tunnel via policy routing.
func SyncXrayRouting(inbounds []api.XrayInbound) error {
	cleanPolicyRange(xrayRouteTableStart, xrayRouteTableEnd, true)

	if len(inbounds) == 0 {
		return nil
	}

	processedLines := make(map[int]bool)
	for _, inb := range inbounds {
		if processedLines[inb.LineID] {
			continue
		}
		processedLines[inb.LineID] = true
		table := fmt.Sprintf("%d", inb.Mark) // use mark value as table number
		markHex := fmt.Sprintf("0x%x", inb.Mark)
		priority := table // unified: priority == table number

		// Add route: default via tunnel in this table
		if err := AddDefaultRoute(inb.Tunnel, table); err != nil {
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
			markHex, inb.Tunnel, inb.LineID, table, priority)
	}

	log.Printf("[routing] Xray routing configured: %d inbounds", len(inbounds))
	return nil
}

// SyncSocks5Routing applies fwmark-based routing for SOCKS5 traffic.
func SyncSocks5Routing(routes []api.Socks5Route) error {
	cleanPolicyRange(socks5RouteTableStart, socks5RouteTableEnd, true)

	if len(routes) == 0 {
		return nil
	}

	for _, route := range routes {
		table := fmt.Sprintf("%d", route.Mark)
		markHex := fmt.Sprintf("0x%x", route.Mark)
		priority := table

		if err := AddDefaultRoute(route.Tunnel, table); err != nil {
			log.Printf("[routing] Error adding socks5 route table %s: %v", table, err)
			continue
		}

		if _, err := Run("ip", "rule", "add", "fwmark", markHex, "lookup", table, "priority", priority); err != nil {
			if !strings.Contains(err.Error(), "File exists") {
				log.Printf("[routing] Error adding socks5 fwmark rule %s: %v", markHex, err)
				continue
			}
		}

		log.Printf("[routing] SOCKS5: fwmark %s → %s (wm-socks5-line-%d, table %s, priority %s)",
			markHex, route.Tunnel, route.LineID, table, priority)
	}

	log.Printf("[routing] SOCKS5 routing configured: %d lines", len(routes))
	return nil
}

// cleanPolicyRange deletes ip rules and flushes routing tables in the given range.
// For fwmark-based rules (Xray/SOCKS5): deletes "ip rule del fwmark 0x<mark>".
// For lookup-based rules (device/relay): deletes "ip rule del lookup <table> priority <table>".
func cleanPolicyRange(start, end int, useFwmark bool) {
	for i := start; i <= end; i++ {
		table := fmt.Sprintf("%d", i)
		var err error
		if useFwmark {
			_, err = RunSilent("ip", "rule", "del", "fwmark", fmt.Sprintf("0x%x", i), "lookup", table)
		} else {
			_, err = RunSilent("ip", "rule", "del", "lookup", table, "priority", table)
		}
		if err != nil {
			break
		}
		RunSilent("ip", "route", "flush", "table", table)
	}
}

// CleanupRouting cleans all routing ranges. Called during shutdown.
func CleanupRouting() {
	cleanPolicyRange(routeTableStart, routeTableEnd, false)
	cleanPolicyRange(relayTableStart, relayTableEnd, false)
	cleanPolicyRange(xrayRouteTableStart, xrayRouteTableEnd, true)
	cleanPolicyRange(socks5RouteTableStart, socks5RouteTableEnd, true)
	log.Println("[routing] Routing cleaned up")
}
