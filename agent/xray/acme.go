package xray

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"golang.org/x/crypto/acme/autocert"

	"github.com/wiremesh/agent/api"
)

func needsAutocert(cfg *api.XrayConfig) bool {
	return cfg.Transport == "ws-tls" && cfg.TlsDomain != "" && cfg.TlsCert == ""
}

func localCertValid(domain string) bool {
	certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, domain)
	data, err := os.ReadFile(certPath)
	if err != nil {
		return false
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}
	return time.Now().Add(30 * 24 * time.Hour).Before(cert.NotAfter)
}

func AutoCert(cfg *api.XrayConfig, client *api.Client) error {
	if !needsAutocert(cfg) {
		return nil
	}

	domain := cfg.TlsDomain
	certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, domain)
	keyPath := fmt.Sprintf("%s/%s.key", XrayConfigDir, domain)

	if localCertValid(domain) {
		log.Printf("[acme] Local cert for %s is still valid, skipping", domain)
		return nil
	}

	log.Printf("[acme] Requesting certificate for %s via HTTP-01", domain)

	cacheDir := XrayConfigDir + "/acme"
	if err := os.MkdirAll(cacheDir, 0700); err != nil {
		return fmt.Errorf("create acme cache dir: %w", err)
	}

	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domain),
		Cache:      autocert.DirCache(cacheDir),
	}

	// Start temporary HTTP server on port 80 for ACME challenge
	srv := &http.Server{
		Addr:    ":80",
		Handler: m.HTTPHandler(nil),
	}

	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	// Give the server a moment to start
	time.Sleep(500 * time.Millisecond)

	// Check if port 80 failed to bind
	select {
	case err := <-errCh:
		return fmt.Errorf("cannot listen on port 80 for ACME HTTP-01 challenge: %w (is port 80 available?)", err)
	default:
	}

	// Request certificate by triggering a TLS handshake with the autocert manager
	hello := &tls.ClientHelloInfo{ServerName: domain}
	tlsCert, err := m.GetCertificate(hello)

	// Stop HTTP server
	srv.Close()

	if err != nil {
		return fmt.Errorf("acme certificate request failed for %s: %w", domain, err)
	}

	// Convert to PEM
	var certPEM []byte
	for _, der := range tlsCert.Certificate {
		certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}

	privDER, err := x509.MarshalPKCS8PrivateKey(tlsCert.PrivateKey)
	if err != nil {
		return fmt.Errorf("marshal private key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})

	// Save locally
	if err := os.MkdirAll(XrayConfigDir, 0755); err != nil {
		return fmt.Errorf("create xray config dir: %w", err)
	}
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return fmt.Errorf("write cert: %w", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		return fmt.Errorf("write key: %w", err)
	}
	log.Printf("[acme] Certificate saved for %s", domain)

	// Upload to platform
	if err := client.UploadCert(domain, string(certPEM), string(keyPEM)); err != nil {
		log.Printf("[acme] Warning: failed to upload cert to platform: %v (cert saved locally)", err)
	} else {
		log.Printf("[acme] Certificate uploaded to platform for %s", domain)
	}

	return nil
}
