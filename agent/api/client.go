package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type BinaryInfo struct {
	Version  string
	Checksum string
}

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) doRequest(method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.httpClient.Do(req)
}

func (c *Client) FetchConfig() (*ConfigData, error) {
	resp, err := c.doRequest("GET", "/api/agent/config", nil)
	if err != nil {
		return nil, fmt.Errorf("fetch config: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch config: status %d: %s", resp.StatusCode, string(body))
	}
	var result ConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode config: %w", err)
	}
	return &result.Data, nil
}

func (c *Client) ReportStatus(report *StatusReport) error {
	resp, err := c.doRequest("POST", "/api/agent/status", report)
	if err != nil {
		return fmt.Errorf("report status: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("report status: status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *Client) ReportError(message string) error {
	resp, err := c.doRequest("POST", "/api/agent/error", &ErrorReport{Message: message})
	if err != nil {
		return fmt.Errorf("report error: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("report error: status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *Client) ReportInstalled() error {
	resp, err := c.doRequest("POST", "/api/agent/installed", struct{}{})
	if err != nil {
		return fmt.Errorf("report installed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("report installed: status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *Client) FetchUninstallScript() ([]byte, error) {
	resp, err := c.doRequest("GET", "/api/uninstall-script", nil)
	if err != nil {
		return nil, fmt.Errorf("fetch uninstall script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch uninstall script: status %d: %s", resp.StatusCode, string(body))
	}
	return io.ReadAll(resp.Body)
}

func (c *Client) FetchBinaryInfo(endpoint string) (*BinaryInfo, error) {
	resp, err := c.doRequest("HEAD", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch binary info: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("fetch binary info: status %d", resp.StatusCode)
	}
	version := resp.Header.Get("X-Agent-Version")
	if version == "" {
		version = resp.Header.Get("X-Xray-Version")
	}
	checksum := resp.Header.Get("X-Agent-Checksum")
	if checksum == "" {
		checksum = resp.Header.Get("X-Xray-Checksum")
	}
	return &BinaryInfo{Version: version, Checksum: checksum}, nil
}

func (c *Client) DownloadBinary(endpoint string) ([]byte, error) {
	resp, err := c.doRequest("GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("download binary: status %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (c *Client) UploadCert(domain, cert, key string) error {
	body := map[string]string{
		"domain": domain,
		"cert":   cert,
		"key":    key,
	}
	resp, err := c.doRequest("POST", "/api/agent/cert", body)
	if err != nil {
		return fmt.Errorf("upload cert: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload cert: status %d: %s", resp.StatusCode, string(data))
	}
	return nil
}
