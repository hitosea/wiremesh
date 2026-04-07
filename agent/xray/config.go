package xray

import (
	"encoding/json"
	"fmt"

	"github.com/wiremesh/agent/api"
)

// GenerateConfig produces the Xray server JSON config with per-line routing.
// Each line gets its own outbound with a unique fwmark, and routing rules
// match UUIDs to their designated outbound (tagged as "wm-xray-line-N").
func GenerateConfig(cfg *api.XrayConfig) ([]byte, error) {
	if cfg == nil {
		return nil, fmt.Errorf("xray config is nil")
	}

	// Collect all clients across all lines
	var allClients []map[string]interface{}
	for _, route := range cfg.Routes {
		for _, uuid := range route.UUIDs {
			allClients = append(allClients, map[string]interface{}{
				"id":   uuid,
				"flow": "xtls-rprx-vision",
			})
		}
	}

	if len(allClients) == 0 {
		return nil, fmt.Errorf("no clients configured")
	}

	// Inbound: single VLESS Reality listener, accepts all clients
	inbound := map[string]interface{}{
		"listen":   "0.0.0.0",
		"port":     cfg.Port,
		"protocol": cfg.Protocol,
		"settings": map[string]interface{}{
			"clients":    allClients,
			"decryption": "none",
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
	}

	// Outbounds: one per line, each with its own fwmark
	var outbounds []map[string]interface{}
	var routingRules []map[string]interface{}

	for _, route := range cfg.Routes {
		tag := fmt.Sprintf("wm-xray-line-%d", route.LineID)

		outbounds = append(outbounds, map[string]interface{}{
			"protocol": "freedom",
			"tag":      tag,
			"streamSettings": map[string]interface{}{
				"sockopt": map[string]interface{}{
					"mark": route.Mark,
				},
			},
		})

		// Routing rule: match UUIDs → this outbound
		routingRules = append(routingRules, map[string]interface{}{
			"type":        "field",
			"user":        route.UUIDs,
			"outboundTag": tag,
		})
	}

	// Fallback outbound (direct, no mark) for unmatched traffic
	outbounds = append(outbounds, map[string]interface{}{
		"protocol": "freedom",
		"tag":      "direct",
	})

	config := map[string]interface{}{
		"log": map[string]interface{}{
			"loglevel": "warning",
		},
		"inbounds": []interface{}{inbound},
		"routing": map[string]interface{}{
			"rules": routingRules,
		},
		"outbounds": outbounds,
	}

	return json.MarshalIndent(config, "", "  ")
}
