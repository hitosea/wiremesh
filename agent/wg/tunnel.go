package wg

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/wiremesh/agent/api"
)

type ActiveTunnel struct {
	Name       string
	PrivateKey string
	Address    string
	ListenPort int
}

func SyncTunnels(desired []api.TunnelInterface, active map[string]ActiveTunnel) (map[string]ActiveTunnel, error) {
	desiredMap := make(map[string]api.TunnelInterface)
	for _, iface := range desired {
		desiredMap[iface.Name] = iface
	}
	var errors []string

	// Destroy removed tunnels
	for name := range active {
		if _, exists := desiredMap[name]; !exists {
			log.Printf("[tunnel] Destroying %s", name)
			if err := destroyTunnel(name); err != nil {
				errors = append(errors, fmt.Sprintf("destroy %s: %v", name, err))
			}
			delete(active, name)
		}
	}

	// Create or update
	for _, iface := range desired {
		existing, exists := active[iface.Name]
		if !exists {
			log.Printf("[tunnel] Creating %s", iface.Name)
			if err := createTunnel(iface); err != nil {
				errors = append(errors, fmt.Sprintf("create %s: %v", iface.Name, err))
				continue
			}
		} else if tunnelChanged(existing, iface) {
			log.Printf("[tunnel] Updating %s", iface.Name)
			if err := updateTunnel(iface); err != nil {
				errors = append(errors, fmt.Sprintf("update %s: %v", iface.Name, err))
				continue
			}
		} else {
			continue
		}
		active[iface.Name] = ActiveTunnel{
			Name: iface.Name, PrivateKey: iface.PrivateKey,
			Address: iface.Address, ListenPort: iface.ListenPort,
		}
	}

	if len(errors) > 0 {
		return active, fmt.Errorf("tunnel sync errors: %s", strings.Join(errors, "; "))
	}
	return active, nil
}

func tunnelChanged(active ActiveTunnel, desired api.TunnelInterface) bool {
	return active.PrivateKey != desired.PrivateKey ||
		active.Address != desired.Address ||
		active.ListenPort != desired.ListenPort
}

func createTunnel(iface api.TunnelInterface) error {
	confPath := writeTunnelConf(iface)
	if err := IpLinkAdd(iface.Name); err != nil {
		return fmt.Errorf("ip link add: %w", err)
	}
	if err := WgSetConf(iface.Name, confPath); err != nil {
		IpLinkDel(iface.Name)
		return fmt.Errorf("wg setconf: %w", err)
	}
	if err := IpAddrAdd(iface.Address, iface.Name); err != nil {
		IpLinkDel(iface.Name)
		return fmt.Errorf("ip addr add: %w", err)
	}
	if err := IpLinkSetUp(iface.Name); err != nil {
		IpLinkDel(iface.Name)
		return fmt.Errorf("ip link set up: %w", err)
	}
	return nil
}

func updateTunnel(iface api.TunnelInterface) error {
	confPath := writeTunnelConf(iface)
	return WgSyncConf(iface.Name, confPath)
}

func destroyTunnel(name string) error {
	IpLinkSetDown(name)
	if err := IpLinkDel(name); err != nil {
		return err
	}
	confPath := fmt.Sprintf("%s/%s.conf", WgConfigDir, name)
	os.Remove(confPath)
	return nil
}

func writeTunnelConf(iface api.TunnelInterface) string {
	confPath := fmt.Sprintf("%s/%s.conf", WgConfigDir, iface.Name)
	var sb strings.Builder
	sb.WriteString("[Interface]\n")
	sb.WriteString(fmt.Sprintf("PrivateKey = %s\n", iface.PrivateKey))
	sb.WriteString(fmt.Sprintf("ListenPort = %d\n", iface.ListenPort))
	sb.WriteString("\n[Peer]\n")
	sb.WriteString(fmt.Sprintf("PublicKey = %s\n", iface.PeerPublicKey))
	if iface.Role == "from" {
		sb.WriteString("AllowedIPs = 0.0.0.0/0\n")
	} else {
		sb.WriteString(fmt.Sprintf("AllowedIPs = %s\n", peerSubnet(iface.Address)))
	}
	sb.WriteString(fmt.Sprintf("Endpoint = %s:%d\n", iface.PeerAddress, iface.PeerPort))
	sb.WriteString("PersistentKeepalive = 25\n")
	os.MkdirAll(WgConfigDir, 0700)
	os.WriteFile(confPath, []byte(sb.String()), 0600)
	return confPath
}

func peerSubnet(address string) string {
	parts := strings.Split(address, "/")
	if len(parts) == 2 {
		ipParts := strings.Split(parts[0], ".")
		if len(ipParts) == 4 {
			lastOctet := 0
			fmt.Sscanf(ipParts[3], "%d", &lastOctet)
			base := lastOctet & 0xFC
			return fmt.Sprintf("%s.%s.%s.%d/%s", ipParts[0], ipParts[1], ipParts[2], base, parts[1])
		}
	}
	return "0.0.0.0/0"
}
