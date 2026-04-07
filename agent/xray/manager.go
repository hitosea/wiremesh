package xray

import (
	"fmt"
	"log"
	"os"
	"os/exec"

	"github.com/wiremesh/agent/api"
)

const (
	XrayConfigDir  = "/etc/wiremesh/xray"
	XrayConfigFile = "/etc/wiremesh/xray/config.json"
	XrayService    = "xray"
)

// Sync generates the Xray config and manages the service.
// If cfg is nil or not enabled, it stops the service.
func Sync(cfg *api.XrayConfig) error {
	if cfg == nil || !cfg.Enabled {
		return stopIfRunning()
	}

	configBytes, err := GenerateConfig(cfg)
	if err != nil {
		return fmt.Errorf("generate xray config: %w", err)
	}

	if err := os.MkdirAll(XrayConfigDir, 0700); err != nil {
		return fmt.Errorf("create xray config dir: %w", err)
	}

	// Check if config changed
	existing, _ := os.ReadFile(XrayConfigFile)
	if string(existing) == string(configBytes) {
		log.Println("[xray] Config unchanged, skipping")
		return ensureRunning()
	}

	if err := os.WriteFile(XrayConfigFile, configBytes, 0600); err != nil {
		return fmt.Errorf("write xray config: %w", err)
	}
	log.Printf("[xray] Config written to %s (%d clients)", XrayConfigFile, len(cfg.UUIDs))

	if isRunning() {
		return restart()
	}
	return start()
}

// Stop stops the Xray service. Called during agent shutdown.
func Stop() {
	if isRunning() {
		log.Println("[xray] Stopping service")
		_ = systemctl("stop", XrayService)
	}
}

func isInstalled() bool {
	_, err := exec.LookPath("xray")
	return err == nil
}

func isRunning() bool {
	return exec.Command("systemctl", "is-active", "--quiet", XrayService).Run() == nil
}

func start() error {
	if !isInstalled() {
		return fmt.Errorf("xray binary not found in PATH; install Xray first")
	}
	log.Println("[xray] Starting service")
	return systemctl("start", XrayService)
}

func restart() error {
	log.Println("[xray] Restarting service")
	return systemctl("restart", XrayService)
}

func stopIfRunning() error {
	if isRunning() {
		log.Println("[xray] Disabling: stopping service")
		return systemctl("stop", XrayService)
	}
	return nil
}

func ensureRunning() error {
	if !isRunning() {
		return start()
	}
	return nil
}

func systemctl(action, service string) error {
	cmd := exec.Command("systemctl", action, service)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s %s: %w: %s", action, service, err, string(output))
	}
	return nil
}
