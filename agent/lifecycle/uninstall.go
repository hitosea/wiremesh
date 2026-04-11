package lifecycle

import (
	"fmt"
	"log"
	"os"
	"os/exec"

	"github.com/wiremesh/agent/api"
)

// RunUninstall downloads the uninstall script from the management platform
// and executes it in an independent systemd scope. Using systemd-run --scope
// ensures the script survives when systemctl stop kills the agent's cgroup.
// Without this, nohup/setsid would not help because systemd kills all
// processes in the service's cgroup, including forked children.
func RunUninstall(client *api.Client) error {
	log.Println("[lifecycle] Downloading uninstall script...")
	script, err := client.FetchUninstallScript()
	if err != nil {
		return fmt.Errorf("download uninstall script: %w", err)
	}

	scriptPath := "/tmp/wiremesh-uninstall.sh"
	if err := os.WriteFile(scriptPath, script, 0755); err != nil {
		return fmt.Errorf("write uninstall script: %w", err)
	}

	log.Println("[lifecycle] Starting uninstall script in independent systemd scope...")
	cmd := exec.Command("systemd-run", "--scope", "--quiet", "bash", scriptPath)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start uninstall script: %w", err)
	}

	log.Printf("[lifecycle] Uninstall script started (PID %d), agent will be stopped by the script", cmd.Process.Pid)
	return nil
}
