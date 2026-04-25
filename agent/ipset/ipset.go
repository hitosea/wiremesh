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
	return CreateHash(name, "ip")
}

// CreateHash creates a hash:<hashType> ipset with the given name.
// hashType can be "ip" or "net". If it already exists, it is flushed.
func CreateHash(name, hashType string) error {
	out, err := exec.Command("ipset", "create", name, "hash:"+hashType, "timeout", "0").CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "already exists") {
			return Flush(name)
		}
		return fmt.Errorf("ipset create %s: %w: %s", name, err, string(out))
	}
	log.Printf("[ipset] Created set: %s (hash:%s)", name, hashType)
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

// Swap atomically swaps the contents of two ipsets of the same type.
func Swap(nameA, nameB string) error {
	out, err := exec.Command("ipset", "swap", nameA, nameB).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ipset swap %s %s: %w: %s", nameA, nameB, err, string(out))
	}
	return nil
}

// Exists reports whether the named ipset exists.
func Exists(name string) bool {
	out, err := exec.Command("ipset", "list", name, "-terse").CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "Name: "+name)
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
	for _, name := range ListWireMesh() {
		Destroy(name)
	}
}

// ListWireMesh returns all ipset names with "wm-" prefix currently present.
func ListWireMesh() []string {
	out, err := exec.Command("ipset", "list", "-name").CombinedOutput()
	if err != nil {
		return nil
	}
	var names []string
	for _, name := range strings.Split(string(out), "\n") {
		name = strings.TrimSpace(name)
		if strings.HasPrefix(name, "wm-") {
			names = append(names, name)
		}
	}
	return names
}
