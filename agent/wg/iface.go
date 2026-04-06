package wg

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/wiremesh/agent/api"
)

const (
	WgConfigDir   = "/etc/wiremesh/wireguard"
	MainInterface = "wm-wg0"
)

func SyncMainInterface(nodeConfig api.NodeConfig, peers []api.PeerConfig) error {
	confPath := fmt.Sprintf("%s/%s.conf", WgConfigDir, MainInterface)

	var sb strings.Builder
	sb.WriteString("[Interface]\n")
	sb.WriteString(fmt.Sprintf("PrivateKey = %s\n", nodeConfig.WgPrivateKey))
	sb.WriteString(fmt.Sprintf("ListenPort = %d\n", nodeConfig.WgPort))

	for _, peer := range peers {
		sb.WriteString("\n[Peer]\n")
		sb.WriteString(fmt.Sprintf("PublicKey = %s\n", peer.PublicKey))
		sb.WriteString(fmt.Sprintf("AllowedIPs = %s\n", peer.AllowedIps))
		sb.WriteString("PersistentKeepalive = 25\n")
	}

	if err := os.MkdirAll(WgConfigDir, 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	if err := os.WriteFile(confPath, []byte(sb.String()), 0600); err != nil {
		return fmt.Errorf("write %s config: %w", MainInterface, err)
	}
	if err := WgSyncConf(MainInterface, confPath); err != nil {
		return fmt.Errorf("syncconf %s: %w", MainInterface, err)
	}

	log.Printf("[wg] Synced %s with %d peers", MainInterface, len(peers))
	return nil
}
