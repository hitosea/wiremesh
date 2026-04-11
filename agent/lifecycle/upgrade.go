package lifecycle

import (
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/xray"
)

const (
	agentBinaryPath = "/usr/local/bin/wiremesh-agent"
	agentBackupPath = "/usr/local/bin/wiremesh-agent.backup"
	xrayBinaryPath  = "/usr/local/bin/wiremesh-xray"
	xrayBackupPath  = "/usr/local/bin/wiremesh-xray.backup"
	xrayService     = "wiremesh-xray"
)

// UpgradeAgent downloads a new agent binary, verifies checksum, replaces the current binary,
// and returns true if the caller should trigger a graceful restart (a.Stop()).
func UpgradeAgent(client *api.Client, currentVersion string) (bool, error) {
	arch := runtime.GOARCH
	endpoint := fmt.Sprintf("/api/agent/binary?arch=%s", arch)

	log.Println("[lifecycle] Checking for agent update...")
	info, err := client.FetchBinaryInfo(endpoint)
	if err != nil {
		return false, fmt.Errorf("check agent version: %w", err)
	}

	if info.Version == currentVersion {
		log.Printf("[lifecycle] Agent already at version %s, skipping", currentVersion)
		return false, nil
	}

	log.Printf("[lifecycle] Upgrading agent from %s to %s...", currentVersion, info.Version)

	data, err := client.DownloadBinary(endpoint)
	if err != nil {
		return false, fmt.Errorf("download agent binary: %w", err)
	}

	if err := verifyChecksum(data, info.Checksum); err != nil {
		return false, fmt.Errorf("checksum verification failed: %w", err)
	}

	if err := extractAndReplace(data, agentBinaryPath, agentBackupPath); err != nil {
		return false, fmt.Errorf("replace agent binary: %w", err)
	}

	log.Printf("[lifecycle] Agent binary replaced. Restart required.")
	return true, nil
}

// UpgradeXray downloads a new Xray binary, verifies checksum, replaces, and restarts the Xray service.
func UpgradeXray(client *api.Client) error {
	arch := runtime.GOARCH
	endpoint := fmt.Sprintf("/api/agent/xray?arch=%s", arch)

	log.Println("[lifecycle] Checking for Xray update...")
	info, err := client.FetchBinaryInfo(endpoint)
	if err != nil {
		return fmt.Errorf("check xray version: %w", err)
	}

	currentVersion := xray.GetVersion()
	if info.Version != "" && info.Version == currentVersion {
		log.Printf("[lifecycle] Xray already at version %s, skipping", currentVersion)
		return nil
	}

	log.Printf("[lifecycle] Upgrading Xray from %s to %s...", currentVersion, info.Version)

	data, err := client.DownloadBinary(endpoint)
	if err != nil {
		return fmt.Errorf("download xray binary: %w", err)
	}

	if err := verifyChecksum(data, info.Checksum); err != nil {
		return fmt.Errorf("checksum verification failed: %w", err)
	}

	if err := extractAndReplace(data, xrayBinaryPath, xrayBackupPath); err != nil {
		return fmt.Errorf("replace xray binary: %w", err)
	}

	log.Println("[lifecycle] Xray binary replaced, restarting service...")
	if err := exec.Command("systemctl", "restart", xrayService).Run(); err != nil {
		return fmt.Errorf("restart xray service: %w", err)
	}

	log.Println("[lifecycle] Xray upgrade complete")
	return nil
}

func verifyChecksum(data []byte, expected string) error {
	if expected == "" {
		log.Println("[lifecycle] Warning: no checksum provided, skipping verification")
		return nil
	}
	expected = strings.TrimPrefix(expected, "sha256:")
	actual := fmt.Sprintf("%x", sha256.Sum256(data))
	if actual != expected {
		return fmt.Errorf("expected %s, got %s", expected, actual)
	}
	log.Println("[lifecycle] Checksum verified")
	return nil
}

func extractAndReplace(tarGzData []byte, targetPath, backupPath string) error {
	tmpTarGz := targetPath + ".new.tar.gz"
	if err := os.WriteFile(tmpTarGz, tarGzData, 0644); err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}
	defer os.Remove(tmpTarGz)

	tmpDir := targetPath + ".new.d"
	os.MkdirAll(tmpDir, 0755)
	defer os.RemoveAll(tmpDir)

	if out, err := exec.Command("tar", "-xzf", tmpTarGz, "-C", tmpDir).CombinedOutput(); err != nil {
		return fmt.Errorf("extract tar.gz: %s: %w", string(out), err)
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil || len(entries) == 0 {
		return fmt.Errorf("no files in extracted archive")
	}
	extractedPath := tmpDir + "/" + entries[0].Name()

	if _, err := os.Stat(targetPath); err == nil {
		if err := copyFile(targetPath, backupPath); err != nil {
			return fmt.Errorf("backup current binary: %w", err)
		}
		log.Printf("[lifecycle] Backed up %s to %s", targetPath, backupPath)
	}

	// Remove the old binary first — Linux allows deleting a running binary
	// (the inode stays alive until the process exits), then we can write to the same path
	os.Remove(targetPath)

	if err := copyFile(extractedPath, targetPath); err != nil {
		return fmt.Errorf("copy new binary: %w", err)
	}
	if err := os.Chmod(targetPath, 0755); err != nil {
		return fmt.Errorf("chmod binary: %w", err)
	}

	return nil
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0755)
}
