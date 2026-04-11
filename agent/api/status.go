package api

type StatusReport struct {
	IsOnline        bool              `json:"is_online"`
	Latency         *int              `json:"latency,omitempty"`
	Transfers       []TransferReport  `json:"transfers,omitempty"`
	Handshakes      []HandshakeReport `json:"handshakes,omitempty"`
	XrayOnlineUsers []string          `json:"xray_online_users,omitempty"`
	AgentVersion    string            `json:"agent_version,omitempty"`
	XrayVersion     string            `json:"xray_version,omitempty"`
	XrayRunning     bool              `json:"xray_running"`
}

type TransferReport struct {
	PeerPublicKey string `json:"peer_public_key"`
	UploadBytes   int64  `json:"upload_bytes"`
	DownloadBytes int64  `json:"download_bytes"`
}

type HandshakeReport struct {
	PeerPublicKey string `json:"peer_public_key"`
	LastHandshake string `json:"last_handshake"` // ISO 8601
}

type ErrorReport struct {
	Message string `json:"message"`
}
