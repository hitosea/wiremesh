package ipset

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// Create creates a hash:ip ipset with the given name.
// If it already exists, it is flushed.
func Create(name string) error {
	out, err := exec.Command("ipset", "create", name, "hash:ip", "timeout", "0").CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "already exists") {
			return Flush(name)
		}
		return fmt.Errorf("ipset create %s: %w: %s", name, err, string(out))
	}
	log.Printf("[ipset] Created set: %s", name)
	return nil
}

// Flush removes all entries from the named ipset.
func Flush(name string) error {
	out, err := exec.Command("ipset", "flush", name).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ipset flush %s: %w: %s", name, err, string(out))
	}
	return nil
}

// Add adds an IP to the ipset with the given timeout (seconds).
// timeout=0 means no expiry.
func Add(name, ip string, timeout int) error {
	args := []string{"add", name, ip}
	if timeout > 0 {
		args = append(args, "timeout", fmt.Sprintf("%d", timeout))
	}
	out, err := exec.Command("ipset", args...).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "already added") {
			return nil
		}
		return fmt.Errorf("ipset add %s %s: %w: %s", name, ip, err, string(out))
	}
	return nil
}

// Destroy removes the named ipset entirely.
func Destroy(name string) error {
	out, err := exec.Command("ipset", "destroy", name).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "does not exist") {
			return nil
		}
		return fmt.Errorf("ipset destroy %s: %w: %s", name, err, string(out))
	}
	log.Printf("[ipset] Destroyed set: %s", name)
	return nil
}

// DestroyAllWireMesh destroys all ipsets with "wm-" prefix.
func DestroyAllWireMesh() {
	out, err := exec.Command("ipset", "list", "-name").CombinedOutput()
	if err != nil {
		return
	}
	for _, name := range strings.Split(string(out), "\n") {
		name = strings.TrimSpace(name)
		if strings.HasPrefix(name, "wm-") {
			Destroy(name)
		}
	}
}
