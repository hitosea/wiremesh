package collector

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/wg"
	"github.com/wiremesh/agent/xray"
)

// previousTransfers stores cumulative values from the last collection,
// keyed by peer public key. Used to calculate deltas.
var (
	previousUpload   = make(map[string]int64)
	previousDownload = make(map[string]int64)
	prevMu           sync.Mutex
)

func Collect(serverURL string, agentVersion string) *api.StatusReport {
	report := &api.StatusReport{IsOnline: true}
	latency := measureLatency(serverURL)
	if latency >= 0 {
		report.Latency = &latency
	}
	report.Transfers = collectTransfers()
	report.Handshakes = collectHandshakes()
	report.XrayOnlineUsers = collectXrayOnlineUsers()
	report.AgentVersion = agentVersion
	report.XrayVersion = xray.GetVersion()
	report.XrayRunning = xray.IsRunning()
	return report
}

func measureLatency(serverURL string) int {
	start := time.Now()
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Head(serverURL)
	if err != nil {
		return -1
	}
	resp.Body.Close()
	return int(time.Since(start).Milliseconds())
}

func collectTransfers() []api.TransferReport {
	// Only collect from wm-wg0 (device access interface).
	// Tunnel interfaces (wm-tun*) are excluded to avoid double-counting.
	raw := parseRawTransfers(wg.MainInterface)

	prevMu.Lock()
	defer prevMu.Unlock()

	var transfers []api.TransferReport
	for _, r := range raw {
		prevUp := previousUpload[r.PeerPublicKey]
		prevDown := previousDownload[r.PeerPublicKey]

		deltaUp := r.UploadBytes - prevUp
		deltaDown := r.DownloadBytes - prevDown

		// Handle counter reset (interface restart)
		if deltaUp < 0 {
			deltaUp = r.UploadBytes
		}
		if deltaDown < 0 {
			deltaDown = r.DownloadBytes
		}

		previousUpload[r.PeerPublicKey] = r.UploadBytes
		previousDownload[r.PeerPublicKey] = r.DownloadBytes

		if deltaUp > 0 || deltaDown > 0 {
			transfers = append(transfers, api.TransferReport{
				PeerPublicKey: r.PeerPublicKey,
				UploadBytes:   deltaUp,
				DownloadBytes: deltaDown,
			})
		}
	}
	return transfers
}

func parseRawTransfers(iface string) []api.TransferReport {
	output, err := wg.WgShow(iface, "transfer")
	if err != nil {
		return nil
	}
	var transfers []api.TransferReport
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 3 {
			continue
		}
		rx, _ := strconv.ParseInt(parts[1], 10, 64)
		tx, _ := strconv.ParseInt(parts[2], 10, 64)
		transfers = append(transfers, api.TransferReport{
			PeerPublicKey: parts[0], UploadBytes: tx, DownloadBytes: rx,
		})
	}
	return transfers
}

func collectHandshakes() []api.HandshakeReport {
	output, err := wg.WgShow(wg.MainInterface, "latest-handshakes")
	if err != nil {
		return nil
	}
	var handshakes []api.HandshakeReport
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 2 {
			continue
		}
		timestamp, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || timestamp == 0 {
			continue
		}
		t := time.Unix(timestamp, 0).UTC()
		handshakes = append(handshakes, api.HandshakeReport{
			PeerPublicKey: parts[0], LastHandshake: t.Format(time.RFC3339),
		})
	}
	return handshakes
}

func collectXrayOnlineUsers() []string {
	cmd := exec.Command("xray", "api", "statsgetallonlineusers", "-s", fmt.Sprintf("127.0.0.1:%d", xray.XrayAPIPort))
	output, err := cmd.Output()
	if err != nil {
		// Xray not running or command failed — silently return empty
		return nil
	}
	return parseXrayOnlineUsers(string(output))
}

func parseXrayOnlineUsers(output string) []string {
	var result struct {
		Users []string `json:"users"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	// Xray returns users in format "user>>>email>>>online", extract the email (our UUID)
	var users []string
	for _, u := range result.Users {
		parts := strings.SplitN(u, ">>>", 3)
		if len(parts) >= 2 {
			users = append(users, parts[1])
		}
	}
	return users
}

func FormatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
