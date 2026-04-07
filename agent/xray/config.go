package xray

import (
	"encoding/json"
	"fmt"

	"github.com/wiremesh/agent/api"
)

type xrayFullConfig struct {
	Log       xrayLog        `json:"log"`
	Inbounds  []xrayInbound  `json:"inbounds"`
	Outbounds []xrayOutbound `json:"outbounds"`
}

type xrayLog struct {
	Loglevel string `json:"loglevel"`
}

type xrayInbound struct {
	Listen         string                 `json:"listen"`
	Port           int                    `json:"port"`
	Protocol       string                 `json:"protocol"`
	Settings       map[string]interface{} `json:"settings"`
	StreamSettings map[string]interface{} `json:"streamSettings"`
}

type xrayOutbound struct {
	Protocol string `json:"protocol"`
	Tag      string `json:"tag"`
}

// GenerateConfig produces the Xray server JSON config for Reality mode.
func GenerateConfig(cfg *api.XrayConfig) ([]byte, error) {
	if cfg == nil {
		return nil, fmt.Errorf("xray config is nil")
	}
	clients := make([]map[string]interface{}, len(cfg.UUIDs))
	for i, uuid := range cfg.UUIDs {
		clients[i] = map[string]interface{}{
			"id":   uuid,
			"flow": "xtls-rprx-vision",
		}
	}

	config := xrayFullConfig{
		Log: xrayLog{Loglevel: "warning"},
		Inbounds: []xrayInbound{
			{
				Listen:   "0.0.0.0",
				Port:     cfg.Port,
				Protocol: cfg.Protocol,
				Settings: map[string]interface{}{
					"clients":    clients,
					"decryption": "none",
				},
				StreamSettings: map[string]interface{}{
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
			},
		},
		Outbounds: []xrayOutbound{
			{Protocol: "freedom", Tag: "direct"},
		},
	}

	return json.MarshalIndent(config, "", "  ")
}
