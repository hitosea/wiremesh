package xray

import (
	"encoding/json"
	"fmt"

	"github.com/wiremesh/agent/api"
)

// GenerateConfig produces the Xray server JSON config with per-branch routing.
// When branches are available, each branch gets its own freedom outbound with
// a branch-specific fwmark, and Xray routing rules match domains to the
// correct outbound. This enables split tunneling at the Xray layer.
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

	var outbounds []map[string]interface{}
	var routingRules []map[string]interface{}

	for _, route := range cfg.Routes {
		if len(route.Branches) > 0 {
			// Branch-based routing: one outbound per branch
			var defaultTag string
			for _, branch := range route.Branches {
				tag := fmt.Sprintf("wm-branch-%d", branch.Mark)
				outbounds = append(outbounds, map[string]interface{}{
					"protocol": "freedom",
					"tag":      tag,
					"streamSettings": map[string]interface{}{
						"sockopt": map[string]interface{}{
							"mark": branch.Mark,
						},
					},
				})

				if branch.IsDefault {
					defaultTag = tag
				} else if len(branch.DomainRules) > 0 {
					// Domain-based routing rule for this branch
					routingRules = append(routingRules, map[string]interface{}{
						"type":        "field",
						"domain":      branch.DomainRules,
						"outboundTag": tag,
					})
				}
			}

			// UUID match → default branch (fallback for all traffic from this line's users)
			if defaultTag != "" {
				routingRules = append(routingRules, map[string]interface{}{
					"type":        "field",
					"user":        route.UUIDs,
					"outboundTag": defaultTag,
				})
			}
		} else {
			// Legacy: single outbound per line (no branch routing)
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
			routingRules = append(routingRules, map[string]interface{}{
				"type":        "field",
				"user":        route.UUIDs,
				"outboundTag": tag,
			})
		}
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
		"inbounds":  []interface{}{inbound},
		"routing":   map[string]interface{}{"rules": routingRules},
		"outbounds": outbounds,
	}

	// If DNS proxy is available, route Xray's DNS through it
	if cfg.DNSProxy != "" {
		config["dns"] = map[string]interface{}{
			"servers": []string{cfg.DNSProxy},
		}
	}

	return json.MarshalIndent(config, "", "  ")
}
