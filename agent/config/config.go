package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	ServerURL      string `yaml:"server_url"`
	NodeID         int    `yaml:"node_id"`
	Token          string `yaml:"token"`
	ReportInterval int    `yaml:"report_interval"` // seconds, default 300
}

const DefaultConfigPath = "/etc/wiremesh/agent.yaml"

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("server_url is required")
	}
	if cfg.NodeID == 0 {
		return nil, fmt.Errorf("node_id is required")
	}
	if cfg.Token == "" {
		return nil, fmt.Errorf("token is required")
	}
	if cfg.ReportInterval <= 0 {
		cfg.ReportInterval = 300
	}

	return &cfg, nil
}
