package agent

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/collector"
	"github.com/wiremesh/agent/config"
	"github.com/wiremesh/agent/httpproxy"
	"github.com/wiremesh/agent/iptables"
	"github.com/wiremesh/agent/lifecycle"
	"github.com/wiremesh/agent/routing"
	"github.com/wiremesh/agent/socks5"
	"github.com/wiremesh/agent/wg"
	"github.com/wiremesh/agent/xray"
)

type Agent struct {
	cfg            *config.Config
	client         *api.Client
	sse            *api.SSEClient
	activeTunnels  map[string]wg.ActiveTunnel
	meshPeers      []api.MeshPeer
	socks5Manager  *socks5.Manager
	httpManager    *httpproxy.Manager
	routingManager *routing.Manager
	lastVersion    string
	lastXray       *api.XrayConfig
	version        string
	ctx            context.Context
	cancel         context.CancelFunc
}

func New(cfg *config.Config, version string) *Agent {
	ctx, cancel := context.WithCancel(context.Background())
	client := api.NewClient(cfg.ServerURL, cfg.Token)
	return &Agent{
		cfg:            cfg,
		client:         client,
		activeTunnels:  make(map[string]wg.ActiveTunnel),
		socks5Manager:  socks5.NewManager(),
		httpManager:    httpproxy.NewManager(),
		routingManager: routing.NewManager(client),
		version:        version,
		ctx:            ctx,
		cancel:         cancel,
	}
}

func (a *Agent) Run() error {
	// 1. Report installation complete
	log.Println("[agent] Reporting installation complete...")
	if err := a.client.ReportInstalled(); err != nil {
		log.Printf("[agent] Warning: failed to report installed: %v", err)
	}

	// 2. Initial config pull and apply
	log.Println("[agent] Pulling initial configuration...")
	if err := a.pullAndApplyConfig(); err != nil {
		log.Printf("[agent] Warning: initial config pull failed: %v", err)
		a.client.ReportError("Initial config pull failed: " + err.Error())
	}

	// 3. Start SSE connection
	a.sse = api.NewSSEClient(a.client)
	a.sse.Start()
	log.Println("[agent] SSE connection started")

	// 4. Start status reporting ticker
	reportTicker := time.NewTicker(time.Duration(a.cfg.ReportInterval) * time.Second)
	defer reportTicker.Stop()

	// Daily cert-renewal ticker (auto-mode ws-tls nodes only)
	certTicker := time.NewTicker(24 * time.Hour)
	defer certTicker.Stop()

	// 5. Event loop
	for {
		select {
		case <-a.ctx.Done():
			a.shutdown()
			return nil
		case evt, ok := <-a.sse.Events():
			if !ok {
				log.Println("[agent] SSE event channel closed")
				return nil
			}
			a.handleSSEEvent(evt)
		case <-reportTicker.C:
			a.reportStatus()
		case <-certTicker.C:
			if err := xray.RenewCertIfNeeded(a.lastXray, a.client); err != nil {
				log.Printf("[agent] Cert renewal check failed: %v", err)
			}
		}
	}
}

func (a *Agent) Stop() { a.cancel() }

func (a *Agent) handleSSEEvent(evt api.SSEEvent) {
	log.Printf("[agent] SSE event: %s", evt.Event)
	switch evt.Event {
	case "connected":
		log.Println("[agent] SSE connected to management platform")
		// Force re-pull on reconnect — may have missed events during disconnect
		if err := a.pullAndApplyConfigForce(true); err != nil {
			log.Printf("[agent] Config pull on reconnect failed: %v", err)
		}
	case "peer_update", "config_update", "tunnel_update":
		if err := a.pullAndApplyConfig(); err != nil {
			log.Printf("[agent] Config apply failed: %v", err)
			a.client.ReportError("Config apply failed: " + err.Error())
		}
	case "node_delete":
		log.Println("[agent] Received node_delete event, starting uninstall...")
		if err := lifecycle.RunUninstall(a.client); err != nil {
			log.Printf("[agent] Uninstall failed: %v", err)
			a.client.ReportError("Uninstall failed: " + err.Error())
		}
	case "request_status_report":
		log.Println("[agent] Received request_status_report, triggering immediate report")
		a.reportStatus()
	case "upgrade":
		a.handleUpgrade()
	case "xray_upgrade":
		a.handleXrayUpgrade()
	}
}

func (a *Agent) handleUpgrade() {
	log.Println("[agent] Received upgrade event, starting agent upgrade...")
	needRestart, err := lifecycle.UpgradeAgent(a.client, a.version)
	if err != nil {
		log.Printf("[agent] Agent upgrade failed: %v", err)
		a.client.ReportError("Agent upgrade failed: " + err.Error())
		// Report online status to recover from "upgrading" state on the server
		a.reportStatus()
		return
	}
	if needRestart {
		log.Println("[agent] Agent upgrade complete, triggering graceful restart...")
		a.Stop()
	}
}

func (a *Agent) handleXrayUpgrade() {
	log.Println("[agent] Received xray_upgrade event, starting Xray upgrade...")
	if err := lifecycle.UpgradeXray(a.client); err != nil {
		log.Printf("[agent] Xray upgrade failed: %v", err)
		a.client.ReportError("Xray upgrade failed: " + err.Error())
	}
}

func (a *Agent) pullAndApplyConfig() error {
	return a.pullAndApplyConfigForce(false)
}

func (a *Agent) pullAndApplyConfigForce(force bool) error {
	cfgData, err := a.client.FetchConfig()
	if err != nil {
		return err
	}

	// Check if node is pending deletion
	if cfgData.PendingDelete {
		log.Println("[agent] Node is pending deletion, starting uninstall...")
		if err := lifecycle.RunUninstall(a.client); err != nil {
			return fmt.Errorf("uninstall on pending delete: %w", err)
		}
		return nil
	}

	if !force && cfgData.Version == a.lastVersion && a.lastVersion != "" {
		log.Println("[agent] Config version unchanged, skipping")
		return nil
	}

	log.Printf("[agent] Applying config version %s", cfgData.Version)

	// 1. Sync wm-wg0 peers
	if err := wg.SyncMainInterface(cfgData.Node, cfgData.Peers); err != nil {
		return err
	}

	// 2. Sync tunnel interfaces
	newActive, err := wg.SyncTunnels(cfgData.Tunnels.Interfaces, a.activeTunnels)
	if err != nil {
		log.Printf("[agent] Tunnel sync had errors: %v", err)
	}
	a.activeTunnels = newActive
	a.meshPeers = cfgData.MeshPeers

	// 3. Sync iptables rules
	if err := iptables.SyncRules(cfgData.Tunnels.IptablesRules); err != nil {
		log.Printf("[agent] iptables sync error: %v", err)
	}

	// 4. Sync per-device routing
	if err := wg.SyncRouting(cfgData.Tunnels.DeviceRoutes); err != nil {
		log.Printf("[agent] routing sync error: %v", err)
	}

	// 5. Sync Xray config
	if err := xray.Sync(cfgData.Xray, a.client); err != nil {
		log.Printf("[agent] xray sync error: %v", err)
	}

	// 6. Sync Xray fwmark routing (each Sync cleans its own range, order-independent)
	if cfgData.Xray != nil && len(cfgData.Xray.Routes) > 0 {
		if err := wg.SyncXrayRouting(cfgData.Xray.Routes); err != nil {
			log.Printf("[agent] xray routing sync error: %v", err)
		}
	}

	// 7. Sync SOCKS5 + HTTP proxy servers
	if a.socks5Manager != nil {
		a.socks5Manager.Sync(cfgData.Socks5)
	}
	if a.httpManager != nil {
		a.httpManager.Sync(cfgData.Http)
	}

	// 8. Sync proxy fwmark routing. SOCKS5 and HTTP share per-line marks, so
	// merge both route sets (dedup by mark) and feed the single range-cleaning
	// sync once — an HTTP-only line still gets its routing table built.
	if err := wg.SyncSocks5Routing(mergeProxyRoutes(cfgData.Socks5, cfgData.Http)); err != nil {
		log.Printf("[agent] proxy routing sync error: %v", err)
	}

	// 9. Sync branch routing (with Xray routes for OUTPUT chain split tunneling)
	var xrayRoutes []api.XrayLineRoute
	if cfgData.Xray != nil {
		xrayRoutes = cfgData.Xray.Routes
	}
	if err := a.routingManager.Sync(cfgData.Routing, xrayRoutes); err != nil {
		log.Printf("[agent] routing sync error: %v", err)
	}

	a.lastVersion = cfgData.Version
	a.lastXray = cfgData.Xray
	xrayStatus := "disabled"
	if cfgData.Xray != nil && cfgData.Xray.Enabled {
		clientCount := 0
		for _, r := range cfgData.Xray.Routes {
			clientCount += len(r.UUIDs)
		}
		xrayStatus = fmt.Sprintf("enabled (%d clients, %d lines)", clientCount, len(cfgData.Xray.Routes))
	}
	socks5Status := "disabled"
	if cfgData.Socks5 != nil && len(cfgData.Socks5.Routes) > 0 {
		userCount := 0
		for _, r := range cfgData.Socks5.Routes {
			userCount += len(r.Users)
		}
		socks5Status = fmt.Sprintf("enabled (%d users, %d lines)", userCount, len(cfgData.Socks5.Routes))
	}
	httpStatus := "disabled"
	if cfgData.Http != nil && len(cfgData.Http.Routes) > 0 {
		userCount := 0
		for _, r := range cfgData.Http.Routes {
			userCount += len(r.Users)
		}
		httpStatus = fmt.Sprintf("enabled (%d users, %d lines)", userCount, len(cfgData.Http.Routes))
	}
	routingStatus := "disabled"
	if cfgData.Routing != nil && cfgData.Routing.Enabled {
		routingStatus = fmt.Sprintf("enabled (%d branches)", len(cfgData.Routing.Branches))
	}
	log.Printf("[agent] Config applied. Tunnels: %d, iptables: %d, xray: %s, socks5: %s, http: %s, routing: %s",
		len(a.activeTunnels), len(cfgData.Tunnels.IptablesRules), xrayStatus, socks5Status, httpStatus, routingStatus)
	return nil
}

func (a *Agent) reportStatus() {
	report := collector.Collect(a.cfg.ServerURL, a.version, a.activeTunnels, a.meshPeers)
	if err := a.client.ReportStatus(report); err != nil {
		log.Printf("[agent] Status report failed: %v", err)
	} else {
		log.Printf("[agent] Status reported (latency: %v, transfers: %d, handshakes: %d)",
			report.Latency, len(report.Transfers), len(report.Handshakes))
	}
}

func (a *Agent) shutdown() {
	log.Println("[agent] Shutting down...")
	if a.sse != nil {
		a.sse.Stop()
	}
	xray.Stop()
	a.socks5Manager.Stop()
	a.httpManager.Stop()
	for name := range a.activeTunnels {
		log.Printf("[agent] Destroying tunnel %s", name)
		wg.IpLinkSetDown(name)
		wg.IpLinkDel(name)
	}
	a.routingManager.Cleanup()
	wg.CleanupRouting()
	iptables.RemoveAllWireMeshRules()
	log.Println("[agent] Shutdown complete")
}

// mergeProxyRoutes unions SOCKS5 and HTTP routes for fwmark routing. Both
// protocols use the same per-line mark/tunnel, so duplicates (a line running
// both proxies) are collapsed by mark. SyncSocks5Routing only reads Mark and
// Tunnel, so the HTTP routes are mapped onto Socks5Route with empty Users.
func mergeProxyRoutes(s *api.Socks5Config, h *api.HttpConfig) []api.Socks5Route {
	seen := make(map[int]bool)
	var out []api.Socks5Route
	if s != nil {
		for _, r := range s.Routes {
			if !seen[r.Mark] {
				seen[r.Mark] = true
				out = append(out, r)
			}
		}
	}
	if h != nil {
		for _, r := range h.Routes {
			if !seen[r.Mark] {
				seen[r.Mark] = true
				out = append(out, api.Socks5Route{LineID: r.LineID, Port: r.Port, Mark: r.Mark, Tunnel: r.Tunnel})
			}
		}
	}
	return out
}
