package api

type StatusReport struct {
	IsOnline         bool                   `json:"is_online"`
	Latency          *int                   `json:"latency,omitempty"`
	Transfers        []TransferReport       `json:"transfers,omitempty"`
	Handshakes       []HandshakeReport      `json:"handshakes,omitempty"`
	XrayOnlineUsers  []string               `json:"xray_online_users,omitempty"`
	XrayTransfers    []XrayTransferReport   `json:"xray_transfers,omitempty"`
	XrayConnections  []XrayConnectionReport `json:"xray_connections,omitempty"`
	Socks5Transfers  []Socks5TransferReport `json:"socks5_transfers,omitempty"`
	ForwardUpload    int64                  `json:"forward_upload,omitempty"`
	ForwardDownload  int64                  `json:"forward_download,omitempty"`
	AgentVersion     string                 `json:"agent_version,omitempty"`
	XrayVersion      string                 `json:"xray_version,omitempty"`
	XrayRunning      bool                   `json:"xray_running"`
	TunnelStatuses   []TunnelStatusReport   `json:"tunnel_statuses,omitempty"`
	PeerPings        []PeerPingReport       `json:"peer_pings,omitempty"`
}

// PeerPingReport: round-trip ping from this node to another node's public host
// over the default route (not through any tunnel). LatencyMs is nil when the
// peer is unreachable.
type PeerPingReport struct {
	NodeID    int  `json:"node_id"`
	LatencyMs *int `json:"latency_ms,omitempty"`
}

// TransferReport: per-peer traffic delta since last report, from the peer's
// (device's) perspective — UploadBytes is what the peer sent us, DownloadBytes
// is what we sent to the peer. Matches XrayTransferReport's uplink/downlink.
type TransferReport struct {
	PeerPublicKey string `json:"peer_public_key"`
	UploadBytes   int64  `json:"upload_bytes"`
	DownloadBytes int64  `json:"download_bytes"`
}

type HandshakeReport struct {
	PeerPublicKey string `json:"peer_public_key"`
	LastHandshake string `json:"last_handshake"` // ISO 8601
}

// XrayTransferReport: per-user traffic delta since last report.
type XrayTransferReport struct {
	Uuid          string `json:"uuid"`
	UploadBytes   int64  `json:"upload_bytes"`
	DownloadBytes int64  `json:"download_bytes"`
}

// Socks5TransferReport: per-line SOCKS5 traffic delta since last report.
// UploadBytes is bytes sent client→destination (egress through the SOCKS5
// server), DownloadBytes is bytes received destination→client. Matches
// the convention used by TransferReport / XrayTransferReport.
type Socks5TransferReport struct {
	LineID        int   `json:"line_id"`
	UploadBytes   int64 `json:"upload_bytes"`
	DownloadBytes int64 `json:"download_bytes"`
}

// XrayConnectionReport: active source IPs for a user, with last_seen unix ts.
type XrayConnectionReport struct {
	Uuid string          `json:"uuid"`
	Ips  []XrayActiveIp  `json:"ips"`
}

type XrayActiveIp struct {
	Ip       string `json:"ip"`
	LastSeen int64  `json:"last_seen"`
}

type ErrorReport struct {
	Message string `json:"message"`
}

// TunnelStatusReport: snapshot of one wm-tun* peer's wg state at report time.
// LastHandshake is unix seconds (0 = never handshaked).
// LatencyMs is the round-trip ping to the peer's WG inner address; nil when
// the peer is unreachable or measurement was skipped.
type TunnelStatusReport struct {
	Iface         string `json:"iface"`
	PeerPublicKey string `json:"peer_public_key"`
	LastHandshake int64  `json:"last_handshake"`
	RxBytes       int64  `json:"rx_bytes"`
	TxBytes       int64  `json:"tx_bytes"`
	LatencyMs     *int   `json:"latency_ms,omitempty"`
}
