package xray

import (
	"encoding/json"
	"fmt"

	"github.com/wiremesh/agent/api"
)

// GenerateConfig produces the Xray server JSON config with per-line inbounds.
// Each line gets its own inbound (unique port), outbound (unique fwmark), and
// routing rule via inboundTag. This ensures complete traffic isolation between
// lines — different lines' Xray users are routed to different WireGuard tunnels.
func GenerateConfig(cfg *api.XrayConfig) ([]byte, error) {
	if cfg == nil {
		return nil, fmt.Errorf("xray config is nil")
	}

	var inbounds []interface{}
	var outbounds []map[string]interface{}
	var routingRules []map[string]interface{}

	for _, route := range cfg.Routes {
		if len(route.UUIDs) == 0 || route.Port == 0 {
			continue
		}

		inboundTag := fmt.Sprintf("in-line-%d", route.LineID)
		outboundTag := fmt.Sprintf("out-line-%d", route.LineID)

		// Collect clients for this line
		var clients []map[string]interface{}
		for _, uuid := range route.UUIDs {
			clients = append(clients, map[string]interface{}{
				"id":   uuid,
				"flow": "xtls-rprx-vision",
			})
		}

		// Inbound: VLESS Reality on this line's port, with sniffing
		inbounds = append(inbounds, map[string]interface{}{
			"tag":      inboundTag,
			"listen":   "0.0.0.0",
			"port":     route.Port,
			"protocol": cfg.Protocol,
			"settings": map[string]interface{}{
				"clients":    clients,
				"decryption": "none",
			},
			"sniffing": map[string]interface{}{
				"enabled":      true,
				"destOverride": []string{"http", "tls"},
			},
			"streamSettings": map[string]interface{}{
				"network":  "tcp",
				"security": "reality",
				"realitySettings": map[string]interface{}{
					"show":        false,
					"dest":        cfg.RealityDest,
					"xver":        0,
					"serverNames": cfg.RealityServerNames,
					"privateKey":  cfg.RealityPrivateKey,
					"shortIds":    []string{cfg.RealityShortId},
				},
			},
		})

		// Outbound: freedom with line-specific fwmark + UseIP for DNS resolution
		outbounds = append(outbounds, map[string]interface{}{
			"protocol": "freedom",
			"tag":      outboundTag,
			"settings": map[string]interface{}{
				"domainStrategy": "UseIP",
			},
			"streamSettings": map[string]interface{}{
				"sockopt": map[string]interface{}{
					"mark": route.Mark,
				},
			},
		})

		// Routing: inbound tag → outbound tag
		routingRules = append(routingRules, map[string]interface{}{
			"type":        "field",
			"inboundTag":  []string{inboundTag},
			"outboundTag": outboundTag,
		})
	}

	if len(inbounds) == 0 {
		return nil, fmt.Errorf("no lines with Xray clients configured")
	}

	// Fallback outbound
	outbounds = append(outbounds, map[string]interface{}{
		"protocol": "freedom",
		"tag":      "direct",
	})

	config := map[string]interface{}{
		"log": map[string]interface{}{
			"loglevel": "warning",
		},
		"inbounds":  inbounds,
		"outbounds": outbounds,
		"routing":   map[string]interface{}{"rules": routingRules},
	}

	// DNS: resolve through Agent DNS proxy so ipsets get populated
	if cfg.DNSProxy != "" {
		config["dns"] = map[string]interface{}{
			"servers":       []string{cfg.DNSProxy},
			"queryStrategy": "UseIPv4",
		}
	}

	return json.MarshalIndent(config, "", "  ")
}
