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
	Version string         `json:"version"`
	PendingDelete bool           `json:"pending_delete"`
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
	DNSProxy           string            `json:"dnsProxy,omitempty"` // agent DNS proxy IP, e.g. "10.210.0.1"
}

// XrayLineRoute maps UUIDs on a specific line to a dedicated inbound+outbound pair.
type XrayLineRoute struct {
	LineID   int              `json:"lineId"`
	UUIDs    []string         `json:"uuids"`
	Port     int              `json:"port"`      // dedicated Xray inbound port for this line
	Tunnel   string           `json:"tunnel"`    // default branch tunnel
	Mark     int              `json:"mark"`      // fwmark for this line's outbound
	Branches []XrayBranch     `json:"branches"`  // per-branch routing for split tunneling
}

// XrayBranch defines a branch outbound for Xray domain-based routing.
type XrayBranch struct {
	Mark        int      `json:"mark"`         // branch fwmark (e.g. 30001)
	Tunnel      string   `json:"tunnel"`       // tunnel interface name
	IsDefault   bool     `json:"is_default"`
	DomainRules []string `json:"domain_rules"` // domains routed to this branch
}

// RoutingConfig contains the routing rules for entry nodes
type RoutingConfig struct {
	Enabled  bool            `json:"enabled"`
	DNS      DNSConfig       `json:"dns"`
	Branches []RoutingBranch `json:"branches"`
}

type DNSConfig struct {
	Listen   string   `json:"listen"`
	Upstream []string `json:"upstream"`
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
