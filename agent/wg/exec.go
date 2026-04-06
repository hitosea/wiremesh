package wg

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

func Run(name string, args ...string) (string, error) {
	log.Printf("[exec] %s %s", name, strings.Join(args, " "))
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, string(output))
	}
	return strings.TrimSpace(string(output)), nil
}

func RunSilent(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("%s: %w: %s", name, err, string(output))
	}
	return strings.TrimSpace(string(output)), nil
}

func WgShow(iface, section string) (string, error) {
	return RunSilent("wg", "show", iface, section)
}

func WgSyncConf(iface, confPath string) error {
	_, err := Run("wg", "syncconf", iface, confPath)
	return err
}

func WgSetConf(iface, confPath string) error {
	_, err := Run("wg", "setconf", iface, confPath)
	return err
}

func IpLinkAdd(iface string) error {
	_, err := Run("ip", "link", "add", iface, "type", "wireguard")
	return err
}

func IpLinkDel(iface string) error {
	_, err := Run("ip", "link", "del", iface)
	return err
}

func IpLinkSetUp(iface string) error {
	_, err := Run("ip", "link", "set", iface, "up")
	return err
}

func IpLinkSetDown(iface string) error {
	_, err := Run("ip", "link", "set", iface, "down")
	return err
}

func IpAddrAdd(addr, iface string) error {
	_, err := Run("ip", "addr", "add", addr, "dev", iface)
	return err
}
