package collector

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/wg"
)

func Collect(serverURL string) *api.StatusReport {
	report := &api.StatusReport{IsOnline: true}
	latency := measureLatency(serverURL)
	if latency >= 0 {
		report.Latency = &latency
	}
	report.Transfers = collectTransfers()
	report.Handshakes = collectHandshakes()
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
	var transfers []api.TransferReport
	transfers = append(transfers, parseTransferOutput(wg.MainInterface)...)
	// Also check tunnel interfaces
	output, err := wg.RunSilent("ip", "-o", "link", "show")
	if err != nil {
		return transfers
	}
	for _, line := range strings.Split(output, "\n") {
		for _, field := range strings.Fields(line) {
			if strings.HasPrefix(field, "wm-tun") {
				name := strings.TrimSuffix(field, ":")
				transfers = append(transfers, parseTransferOutput(name)...)
				break
			}
		}
	}
	return transfers
}

func parseTransferOutput(iface string) []api.TransferReport {
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
