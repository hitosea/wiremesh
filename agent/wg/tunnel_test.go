package wg

import (
	"testing"

	"github.com/wiremesh/agent/api"
)

func TestTunnelChangedDetectsMTU(t *testing.T) {
	active := ActiveTunnel{
		Name: "wm-tun1", PrivateKey: "priv", Address: "10.211.0.1/30",
		ListenPort: 41830, PeerPublicKey: "peer", PeerAddress: "example.com",
		PeerPort: 41831, MTU: 1420,
	}
	desired := api.TunnelInterface{
		Name: "wm-tun1", PrivateKey: "priv", Address: "10.211.0.1/30",
		ListenPort: 41830, PeerPublicKey: "peer", PeerAddress: "example.com",
		PeerPort: 41831, MTU: 1380,
	}

	if !tunnelChanged(active, desired) {
		t.Fatal("expected MTU change to require tunnel update")
	}

	desired.MTU = active.MTU
	if tunnelChanged(active, desired) {
		t.Fatal("expected identical tunnel to be unchanged")
	}
}
