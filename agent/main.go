package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wiremesh/agent/config"
)

func main() {
	configPath := flag.String("config", config.DefaultConfigPath, "path to agent config file")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("WireMesh Agent starting...")

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Config loaded: server=%s node_id=%d report_interval=%ds",
		cfg.ServerURL, cfg.NodeID, cfg.ReportInterval)

	// Wait for shutdown signal (will be replaced with agent.Run in Task 8)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Agent shutting down...")
}
