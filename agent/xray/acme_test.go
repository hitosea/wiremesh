package xray

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/wiremesh/agent/api"
)

// makeCertPEM builds a self-signed cert PEM valid until notAfter.
func makeCertPEM(t *testing.T, notAfter time.Time) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "vpn.example.com"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("createcert: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

func TestNeedsAutocert(t *testing.T) {
	cases := []struct {
		name string
		cfg  *api.XrayConfig
		want bool
	}{
		{"auto+domain", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "d", CertMode: "auto"}, true},
		{"manual", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "d", CertMode: "manual"}, false},
		{"certd", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "d", CertMode: "certd"}, false},
		{"auto-but-reality", &api.XrayConfig{Transport: "reality", TlsDomain: "d", CertMode: "auto"}, false},
		{"auto-no-domain", &api.XrayConfig{Transport: "ws-tls", TlsDomain: "", CertMode: "auto"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := needsAutocert(c.cfg); got != c.want {
				t.Fatalf("needsAutocert=%v want %v", got, c.want)
			}
		})
	}
}

func TestCertValid_FromCfg(t *testing.T) {
	farFuture := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: makeCertPEM(t, time.Now().Add(60*24*time.Hour))}
	if !certValid(farFuture) {
		t.Fatal("expected cert valid for >30 days to be considered valid")
	}
	nearExpiry := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: makeCertPEM(t, time.Now().Add(10*24*time.Hour))}
	if certValid(nearExpiry) {
		t.Fatal("expected cert within 30 days of expiry to be considered invalid (needs renewal)")
	}
	empty := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: ""}
	if certValid(empty) {
		t.Fatal("expected empty cert (and no disk file) to be invalid")
	}
	malformed := &api.XrayConfig{TlsDomain: "vpn.example.com", TlsCert: "garbage not a pem"}
	if certValid(malformed) {
		t.Fatal("expected malformed (non-PEM) cert to be invalid")
	}
}
