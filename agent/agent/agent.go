package agent

import (
	"context"
	"log"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/collector"
	"github.com/wiremesh/agent/config"
	"github.com/wiremesh/agent/iptables"
	"github.com/wiremesh/agent/wg"
)

type Agent struct {
	cfg           *config.Config
	client        *api.Client
	sse           *api.SSEClient
	activeTunnels map[string]wg.ActiveTunnel
	lastVersion   string
	ctx           context.Context
	cancel        context.CancelFunc
}

func New(cfg *config.Config) *Agent {
	ctx, cancel := context.WithCancel(context.Background())
	return &Agent{
		cfg:           cfg,
		client:        api.NewClient(cfg.ServerURL, cfg.Token),
		activeTunnels: make(map[string]wg.ActiveTunnel),
		ctx:           ctx,
		cancel:        cancel,
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

	// 3. Sync iptables rules
	if err := iptables.SyncRules(cfgData.Tunnels.IptablesRules); err != nil {
		log.Printf("[agent] iptables sync error: %v", err)
	}

	// 4. Sync per-device routing
	if err := wg.SyncRouting(cfgData.Tunnels.DeviceRoutes); err != nil {
		log.Printf("[agent] routing sync error: %v", err)
	}

	a.lastVersion = cfgData.Version
	log.Printf("[agent] Config applied. Tunnels: %d, iptables rules: %d",
		len(a.activeTunnels), len(cfgData.Tunnels.IptablesRules))
	return nil
}

func (a *Agent) reportStatus() {
	report := collector.Collect(a.cfg.ServerURL)
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
	for name := range a.activeTunnels {
		log.Printf("[agent] Destroying tunnel %s", name)
		wg.IpLinkSetDown(name)
		wg.IpLinkDel(name)
	}
	wg.CleanupRouting()
	iptables.RemoveAllWireMeshRules()
	log.Println("[agent] Shutdown complete")
}
