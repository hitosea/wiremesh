package api

// ConfigResponse matches GET /api/agent/config JSON response
type ConfigResponse struct {
	Data ConfigData `json:"data"`
}

type ConfigData struct {
	Node    NodeConfig     `json:"node"`
	Peers   []PeerConfig   `json:"peers"`
	Tunnels TunnelConfig   `json:"tunnels"`
	Xray    *XrayConfig    `json:"xray"`
	Socks5  *Socks5Config  `json:"socks5"`
	Routing *RoutingConfig `json:"routing"`
	MeshPeers []MeshPeer   `json:"meshPeers,omitempty"`
	Version string         `json:"version"`
	PendingDelete bool           `json:"pending_delete"`
}

// MeshPeer is another node this agent should periodically ping for the all-pairs
// latency matrix. Host is the most reachable form (domain or public IP).
type MeshPeer struct {
	NodeID int    `json:"nodeId"`
	Host   string `json:"host"`
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

// XrayConfig is delivered per-node by the platform.
type XrayConfig struct {
	Enabled  bool          `json:"enabled"`
	Inbounds []XrayInbound `json:"inbounds"`
	DNSProxy string        `json:"dnsProxy,omitempty"`
}

// XrayInbound describes one (line, transport) listener.
type XrayInbound struct {
	LineID    int    `json:"lineId"`
	Transport string `json:"transport"` // "reality" | "ws-tls"
	Protocol  string `json:"protocol"`  // "vless"
	Port      int    `json:"port"`

	// reality fields
	RealityPrivateKey  string   `json:"realityPrivateKey,omitempty"`
	RealityShortId     string   `json:"realityShortId,omitempty"`
	RealityDest        string   `json:"realityDest,omitempty"`
	RealityServerNames []string `json:"realityServerNames,omitempty"`

	// ws-tls fields
	WsPath    string `json:"wsPath,omitempty"`
	TlsDomain string `json:"tlsDomain,omitempty"`
	TlsCert   string `json:"tlsCert,omitempty"`
	TlsKey    string `json:"tlsKey,omitempty"`

	// routing
	UUIDs    []string         `json:"uuids"`
	Mark     int              `json:"mark"`
	Tunnel   string           `json:"tunnel"`
	Branches []XrayLineBranch `json:"branches"`
}

type XrayLineBranch struct {
	Mark        int      `json:"mark"`
	Tunnel      string   `json:"tunnel"`
	IsDefault   bool     `json:"is_default"`
	DomainRules []string `json:"domain_rules"`
}

// RoutingConfig contains the routing rules for entry nodes
type RoutingConfig struct {
	Enabled  bool            `json:"enabled"`
	DNS      DNSConfig       `json:"dns"`
	Branches []RoutingBranch `json:"branches"`
}

type DNSConfig struct {
	Listen     string   `json:"listen"`
	Upstream   []string `json:"upstream"`
	BindDevice string   `json:"bindDevice,omitempty"` // interface to bind upstream queries to (e.g. "wm-tun1"), empty = no binding
}

type RoutingBranch struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	IsDefault   bool         `json:"is_default"`
	Tunnel      string       `json:"tunnel"`
	Mark        int          `json:"mark"`
	IPRules     []string     `json:"ip_rules"`
	DomainRules []string     `json:"domain_rules"`
	RuleSources []RuleSource `json:"rule_sources"`
	DeviceIPs   []string     `json:"device_ips"` // WG device source IPs for this line (scopes PREROUTING rules)
}

type RuleSource struct {
	FilterID     int    `json:"filter_id"`
	URL          string `json:"url"`
	SyncInterval int    `json:"sync_interval"` // seconds
}

type Socks5Config struct {
	Routes []Socks5Route `json:"routes"`
}

type Socks5Route struct {
	LineID int          `json:"lineId"`
	Port   int          `json:"port"`
	Mark   int          `json:"mark"`
	Tunnel string       `json:"tunnel"`
	Users  []Socks5User `json:"users"`
}

type Socks5User struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
