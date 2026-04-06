package api

type StatusReport struct {
	IsOnline   bool              `json:"is_online"`
	Latency    *int              `json:"latency,omitempty"`
	Transfers  []TransferReport  `json:"transfers,omitempty"`
	Handshakes []HandshakeReport `json:"handshakes,omitempty"`
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
