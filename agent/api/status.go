package api

type StatusReport struct {
	IsOnline         bool                   `json:"is_online"`
	Latency          *int                   `json:"latency,omitempty"`
	Transfers        []TransferReport       `json:"transfers,omitempty"`
	Handshakes       []HandshakeReport      `json:"handshakes,omitempty"`
	XrayOnlineUsers  []string               `json:"xray_online_users,omitempty"`
	XrayTransfers    []XrayTransferReport   `json:"xray_transfers,omitempty"`
	XrayConnections  []XrayConnectionReport `json:"xray_connections,omitempty"`
	ForwardUpload    int64                  `json:"forward_upload,omitempty"`
	ForwardDownload  int64                  `json:"forward_download,omitempty"`
	AgentVersion     string                 `json:"agent_version,omitempty"`
	XrayVersion      string                 `json:"xray_version,omitempty"`
	XrayRunning      bool                   `json:"xray_running"`
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
