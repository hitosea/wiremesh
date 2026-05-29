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
	return cfg.Transport == "ws-tls" && cfg.TlsDomain != "" && cfg.CertMode == "auto"
}

// certValid reports whether the effective certificate for the domain is valid
// for at least 30 more days. It prefers the platform-supplied PEM (cfg.TlsCert)
// and falls back to the on-disk file, so a fresh disk (no file yet) does not
// trigger a needless re-issue when the platform already holds a valid cert.
func certValid(cfg *api.XrayConfig) bool {
	var data []byte
	if cfg.TlsCert != "" {
		data = []byte(cfg.TlsCert)
	} else {
		certPath := fmt.Sprintf("%s/%s.crt", XrayConfigDir, cfg.TlsDomain)
		b, err := os.ReadFile(certPath)
		if err != nil {
			return false
		}
		data = b
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

	if certValid(cfg) {
		log.Printf("[acme] Cert for %s still valid (>30d), skipping", domain)
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

	// Make the freshly issued cert the effective one for the rest of this Sync
	// pass (writeCertFiles + GenerateConfig + restart), and for the next call.
	// writeCertFiles is the single writer of the leaf cert/key files, so it can
	// detect the change and trigger an Xray restart on renewal.
	cfg.TlsCert = string(certPEM)
	cfg.TlsKey = string(keyPEM)

	// Upload to platform
	if err := client.UploadCert(domain, string(certPEM), string(keyPEM)); err != nil {
		log.Printf("[acme] Warning: failed to upload cert to platform: %v (cert saved locally)", err)
	} else {
		log.Printf("[acme] Certificate uploaded to platform for %s", domain)
	}

	return nil
}
