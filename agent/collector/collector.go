package collector

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wiremesh/agent/api"
	"github.com/wiremesh/agent/socks5"
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

var (
	previousXrayUpload   = make(map[string]int64)
	previousXrayDownload = make(map[string]int64)
	xrayMu               sync.Mutex
)

var (
	previousForwardUpload   = make(map[string]int64)
	previousForwardDownload = make(map[string]int64)
	forwardMu               sync.Mutex
)

// xrayIpCache stabilizes per-UUID active-IP observations. Xray's OnlineMap
// ref-counts by live TCP connection, so a client briefly reopening its
// Reality connection can drop its IP from the map for one polling interval
// — causing the "online x N" badge to flicker between 2 and 1. Keeping
// recently observed IPs for xrayIpStabilizationWindow smooths that out while
// still dropping truly-gone clients within a few minutes.
const xrayIpStabilizationWindow = 180 * time.Second

var (
	xrayIpCache   = make(map[string]map[string]int64) // uuid -> ip -> observed unix seconds
	xrayIpCacheMu sync.Mutex
)

func Collect(serverURL string, agentVersion string, tunnels map[string]wg.ActiveTunnel) *api.StatusReport {
	report := &api.StatusReport{IsOnline: true}
	latency := measureLatency(serverURL)
	if latency >= 0 {
		report.Latency = &latency
	}
	report.Transfers = collectTransfers()
	report.Handshakes = collectHandshakes()
	report.XrayOnlineUsers = collectXrayOnlineUsers()
	report.XrayTransfers = collectXrayTransfers()
	report.XrayConnections = collectXrayConnections(report.XrayOnlineUsers)
	report.Socks5Transfers = socks5.CollectTransfers()
	fwUp, fwDown := collectForwardTransfers()
	report.ForwardUpload = fwUp
	report.ForwardDownload = fwDown
	report.AgentVersion = agentVersion
	report.XrayVersion = xray.GetVersion()
	report.XrayRunning = xray.IsRunning()
	// Collect wm-tun* states (best-effort; failure shouldn't fail the whole report)
	if dump, err := wg.WgShowAllDump(); err == nil {
		statuses := parseTunnelStatuses(dump)
		measureTunnelLatencies(statuses, tunnels)
		report.TunnelStatuses = statuses
	} else {
		log.Printf("[collector] WgShowAllDump failed: %v", err)
	}
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
		// wg show is node-perspective; flip to peer-perspective for TransferReport.
		rx, _ := strconv.ParseInt(parts[1], 10, 64)
		tx, _ := strconv.ParseInt(parts[2], 10, 64)
		transfers = append(transfers, api.TransferReport{
			PeerPublicKey: parts[0], UploadBytes: rx, DownloadBytes: tx,
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
	cmd := exec.Command(xray.XrayBinary, "api", "statsgetallonlineusers", "-s", fmt.Sprintf("127.0.0.1:%d", xray.XrayAPIPort))
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	return parseXrayOnlineUsers(string(output))
}

// parseXrayOnlineUsers parses `xray api statsgetallonlineusers`. Xray returns
// the OnlineMap registration names directly: {"users": ["user>>>email>>>online",
// ...]}. See /app/dispatcher/default.go:trackOnlineIP in xray-core source —
// the registration key is "user>>>"+email+">>>online". Extract the email.
func parseXrayOnlineUsers(output string) []string {
	var result struct {
		Users []string `json:"users"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	users := make([]string, 0, len(result.Users))
	for _, u := range result.Users {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if parts := strings.SplitN(u, ">>>", 3); len(parts) >= 2 {
			users = append(users, parts[1])
		} else {
			users = append(users, u)
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

type xrayUserTraffic struct {
	uplink   int64
	downlink int64
}

// parseXrayTransfers turns `xray api statsquery -pattern "user>>>"` output
// into a uuid -> (uplink, downlink) map of cumulative byte counters.
// Stat keys look like "user>>>uuid>>>traffic>>>uplink" or ">>>downlink".
func parseXrayTransfers(output string) map[string]xrayUserTraffic {
	var result struct {
		Stat []struct {
			Name  string `json:"name"`
			Value int64  `json:"value"`
		} `json:"stat"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	out := make(map[string]xrayUserTraffic)
	for _, s := range result.Stat {
		parts := strings.Split(s.Name, ">>>")
		if len(parts) != 4 || parts[0] != "user" || parts[2] != "traffic" {
			continue
		}
		uuid := parts[1]
		entry := out[uuid]
		switch parts[3] {
		case "uplink":
			entry.uplink = s.Value
		case "downlink":
			entry.downlink = s.Value
		}
		out[uuid] = entry
	}
	return out
}

func parseXrayOnlineIpList(output string) []api.XrayActiveIp {
	var result struct {
		Ips map[string]int64 `json:"ips"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		return nil
	}
	ips := make([]api.XrayActiveIp, 0, len(result.Ips))
	for ip, lastSeen := range result.Ips {
		ips = append(ips, api.XrayActiveIp{Ip: ip, LastSeen: lastSeen})
	}
	return ips
}

func collectXrayTransfers() []api.XrayTransferReport {
	cmd := exec.Command(xray.XrayBinary, "api", "statsquery",
		"-pattern", "user>>>", "-s",
		fmt.Sprintf("127.0.0.1:%d", xray.XrayAPIPort))
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	current := parseXrayTransfers(string(out))
	if len(current) == 0 {
		return nil
	}

	xrayMu.Lock()
	defer xrayMu.Unlock()

	var reports []api.XrayTransferReport
	for uuid, v := range current {
		prevUp := previousXrayUpload[uuid]
		prevDown := previousXrayDownload[uuid]
		deltaUp := v.uplink - prevUp
		deltaDown := v.downlink - prevDown
		if deltaUp < 0 {
			deltaUp = v.uplink
		}
		if deltaDown < 0 {
			deltaDown = v.downlink
		}
		previousXrayUpload[uuid] = v.uplink
		previousXrayDownload[uuid] = v.downlink
		if deltaUp > 0 || deltaDown > 0 {
			reports = append(reports, api.XrayTransferReport{
				Uuid:          uuid,
				UploadBytes:   deltaUp,
				DownloadBytes: deltaDown,
			})
		}
	}
	return reports
}

func collectXrayConnections(onlineUuids []string) []api.XrayConnectionReport {
	now := time.Now().Unix()
	sweepStaleXrayIpCache(now)
	if len(onlineUuids) == 0 {
		return nil
	}
	reports := make([]api.XrayConnectionReport, 0, len(onlineUuids))
	for _, uuid := range onlineUuids {
		cmd := exec.Command(xray.XrayBinary, "api", "statsonlineiplist",
			"-email", uuid, "-s",
			fmt.Sprintf("127.0.0.1:%d", xray.XrayAPIPort))
		out, err := cmd.Output()
		if err != nil {
			continue
		}
		current := parseXrayOnlineIpList(string(out))
		stabilized := stabilizeXrayIps(uuid, current, now)
		reports = append(reports, api.XrayConnectionReport{
			Uuid: uuid,
			Ips:  stabilized,
		})
	}
	return reports
}

// stabilizeXrayIps merges fresh `current` observations into a per-UUID sticky
// cache and returns all IPs observed within xrayIpStabilizationWindow.
func stabilizeXrayIps(uuid string, current []api.XrayActiveIp, now int64) []api.XrayActiveIp {
	cutoff := now - int64(xrayIpStabilizationWindow/time.Second)

	xrayIpCacheMu.Lock()
	defer xrayIpCacheMu.Unlock()

	cache, ok := xrayIpCache[uuid]
	if !ok {
		cache = make(map[string]int64)
		xrayIpCache[uuid] = cache
	}
	for _, ip := range current {
		cache[ip.Ip] = now
	}
	for ip, t := range cache {
		if t < cutoff {
			delete(cache, ip)
		}
	}
	if len(cache) == 0 {
		delete(xrayIpCache, uuid)
		return nil
	}

	out := make([]api.XrayActiveIp, 0, len(cache))
	for ip, t := range cache {
		out = append(out, api.XrayActiveIp{Ip: ip, LastSeen: t})
	}
	return out
}

// sweepStaleXrayIpCache evicts IP entries older than the stabilization window
// across all UUIDs. Needed because stabilizeXrayIps only runs for UUIDs still
// in Xray's online list — a deleted or long-term-offline user's cache would
// otherwise persist forever.
func sweepStaleXrayIpCache(now int64) {
	cutoff := now - int64(xrayIpStabilizationWindow/time.Second)
	xrayIpCacheMu.Lock()
	defer xrayIpCacheMu.Unlock()
	for uuid, cache := range xrayIpCache {
		for ip, t := range cache {
			if t < cutoff {
				delete(cache, ip)
			}
		}
		if len(cache) == 0 {
			delete(xrayIpCache, uuid)
		}
	}
}

// collectForwardTransfers sums per-peer transfer across all wm-tun* interfaces
// on this node. This represents inter-node forward traffic (for exit/relay
// nodes this is the dominant contribution; for entry nodes it roughly equals
// the wm-wg0 traffic, but is counted separately so the UI can distinguish
// "client-side traffic" from "transit traffic").
//
// Returns (uploadDelta, downloadDelta) since last call.
func collectForwardTransfers() (int64, int64) {
	ifaces := listTunnelInterfaces()
	if len(ifaces) == 0 {
		return 0, 0
	}
	var totalUp, totalDown int64
	for _, iface := range ifaces {
		output, err := wg.WgShow(iface, "transfer")
		if err != nil {
			continue
		}
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
			// Peer key is unique across tunnels; safe to key on it.
			key := iface + "\t" + parts[0]

			forwardMu.Lock()
			prevUp := previousForwardUpload[key]
			prevDown := previousForwardDownload[key]
			deltaUp := tx - prevUp
			deltaDown := rx - prevDown
			if deltaUp < 0 {
				deltaUp = tx
			}
			if deltaDown < 0 {
				deltaDown = rx
			}
			previousForwardUpload[key] = tx
			previousForwardDownload[key] = rx
			forwardMu.Unlock()

			totalUp += deltaUp
			totalDown += deltaDown
		}
	}
	return totalUp, totalDown
}

// parseTunnelStatuses parses `wg show all dump` output and returns peer rows
// for wm-tun* interfaces only. Each interface in the output emits:
//   - one interface line (5 tab-separated fields): iface, privkey, pubkey, listen-port, fwmark
//   - one peer line per peer (9 fields): iface, pubkey, preshared, endpoint, allowed-ips,
//     latest-handshake, rx, tx, keepalive
//
// We identify peer lines by field count == 9.
func parseTunnelStatuses(dump string) []api.TunnelStatusReport {
	var out []api.TunnelStatusReport
	for _, line := range strings.Split(dump, "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 9 {
			continue // skip interface lines and malformed rows
		}
		iface := fields[0]
		if !strings.HasPrefix(iface, "wm-tun") {
			continue
		}
		out = append(out, api.TunnelStatusReport{
			Iface:         iface,
			PeerPublicKey: fields[1],
			LastHandshake: parseInt64Safe(fields[5]),
			RxBytes:       parseInt64Safe(fields[6]),
			TxBytes:       parseInt64Safe(fields[7]),
		})
	}
	return out
}

func parseInt64Safe(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func measureTunnelLatencies(statuses []api.TunnelStatusReport, tunnels map[string]wg.ActiveTunnel) {
	if len(statuses) == 0 || len(tunnels) == 0 {
		return
	}
	var grp sync.WaitGroup
	for i := range statuses {
		t, ok := tunnels[statuses[i].Iface]
		if !ok {
			continue
		}
		peerIP := peerInnerIp(t.Address)
		if peerIP == "" {
			continue
		}
		grp.Add(1)
		go func() {
			defer grp.Done()
			if ms := pingPeer(statuses[i].Iface, peerIP); ms != nil {
				statuses[i].LatencyMs = ms
			}
		}()
	}
	grp.Wait()
}

// peerInnerIp returns the peer's WG inner IP for a /30 tunnel pair given the
// local CIDR address. Returns "" if the address can't be parsed or isn't a /30.
func peerInnerIp(localAddr string) string {
	parts := strings.Split(localAddr, "/")
	if len(parts) != 2 || parts[1] != "30" {
		return ""
	}
	octets := strings.Split(parts[0], ".")
	if len(octets) != 4 {
		return ""
	}
	last, err := strconv.Atoi(octets[3])
	if err != nil {
		return ""
	}
	base := last & 0xFC
	var peer int
	switch last {
	case base + 1:
		peer = base + 2
	case base + 2:
		peer = base + 1
	default:
		return ""
	}
	return fmt.Sprintf("%s.%s.%s.%d", octets[0], octets[1], octets[2], peer)
}

var pingRttRe = regexp.MustCompile(`time=([0-9.]+) ms`)

// pingPeer probes the peer with one ICMP packet, then sends two more to refine
// the estimate. Returns the minimum RTT in ms, or nil if the probe times out —
// fail-fast on the first packet so unreachable peers don't stall the report.
func pingPeer(iface, peerIP string) *int {
	out, err := exec.Command("ping", "-n", "-c", "1", "-W", "1", "-I", iface, peerIP).Output()
	if err != nil {
		return nil
	}
	rtts := parsePingRtts(string(out))
	if len(rtts) == 0 {
		return nil
	}
	if more, err := exec.Command("ping", "-n", "-c", "2", "-W", "1", "-i", "0.2", "-I", iface, peerIP).Output(); err == nil {
		rtts = append(rtts, parsePingRtts(string(more))...)
	}
	ms := int(slices.Min(rtts) + 0.5)
	return &ms
}

func parsePingRtts(output string) []float64 {
	matches := pingRttRe.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]float64, 0, len(matches))
	for _, m := range matches {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			out = append(out, v)
		}
	}
	return out
}

// listTunnelInterfaces returns all `wm-tun*` interface names currently up.
func listTunnelInterfaces() []string {
	out, err := exec.Command("ip", "-o", "link", "show").Output()
	if err != nil {
		return nil
	}
	var ifaces []string
	for _, line := range strings.Split(string(out), "\n") {
		// Lines look like: "6: wm-tun1: <POINTOPOINT,...>"
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSuffix(parts[1], ":")
		name = strings.TrimSuffix(name, "@NONE")
		if strings.HasPrefix(name, "wm-tun") {
			ifaces = append(ifaces, name)
		}
	}
	return ifaces
}
