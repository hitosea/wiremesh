package api

// ConfigResponse matches GET /api/agent/config JSON response
type ConfigResponse struct {
	Data ConfigData `json:"data"`
}

type ConfigData struct {
	Node    NodeConfig   `json:"node"`
	Peers   []PeerConfig `json:"peers"`
	Tunnels TunnelConfig `json:"tunnels"`
	Xray    *XrayConfig  `json:"xray"`
	Version string       `json:"version"`
}

type NodeConfig struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	WgAddress    string `json:"wgAddress"`
	WgPort       int    `json:"wgPort"`
	WgPrivateKey string `json:"wgPrivateKey"`
}

type PeerConfig struct {
	PublicKey  string `json:"publicKey"`
	AllowedIps string `json:"allowedIps"`
}

type TunnelConfig struct {
	Interfaces    []TunnelInterface `json:"interfaces"`
	IptablesRules []string          `json:"iptablesRules"`
	DeviceRoutes  []DeviceRoute     `json:"deviceRoutes"`
}

type TunnelInterface struct {
	Name          string `json:"name"`
	PrivateKey    string `json:"privateKey"`
	Address       string `json:"address"`
	ListenPort    int    `json:"listenPort"`
	PeerPublicKey string `json:"peerPublicKey"`
	PeerAddress   string `json:"peerAddress"`
	PeerPort      int    `json:"peerPort"`
	Role          string `json:"role"` // "from" or "to"
}

// DeviceRoute maps a device IP to the tunnel it should use.
type DeviceRoute struct {
	Destination string `json:"destination"` // e.g. "10.210.0.100/32"
	Tunnel      string `json:"tunnel"`      // e.g. "wm-tun1"
	Type        string `json:"type"`        // "entry" = source-based routing, "exit" = destination-based routing
}

type XrayConfig struct {
	Enabled            bool              `json:"enabled"`
	Protocol           string            `json:"protocol"`
	Port               int               `json:"port"`
	RealityPrivateKey  string            `json:"realityPrivateKey"`
	RealityShortId     string            `json:"realityShortId"`
	RealityDest        string            `json:"realityDest"`
	RealityServerNames []string          `json:"realityServerNames"`
	Routes             []XrayLineRoute   `json:"routes"`
}

// XrayLineRoute maps UUIDs on a specific line to a tunnel via fwmark.
type XrayLineRoute struct {
	LineID int      `json:"lineId"`
	UUIDs  []string `json:"uuids"`
	Tunnel string   `json:"tunnel"` // e.g. "wm-tun1"
	Mark   int      `json:"mark"`   // fwmark value, e.g. 201
}
