package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wiremesh/agent/agent"
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

	a := agent.New(cfg)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("Received shutdown signal")
		a.Stop()
	}()

	if err := a.Run(); err != nil {
		log.Fatalf("Agent error: %v", err)
	}
	log.Println("WireMesh Agent stopped")
}
