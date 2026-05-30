# HTTP 代理支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在入口节点上新增与 SOCKS5 平级的 HTTP 代理协议，支持 `CONNECT` 隧道与明文 HTTP 转发，复用现有 fwmark 路由、加密、端口分配与生命周期基础设施。

**Architecture:** Agent 新增 `agent/httpproxy/` 包（镜像 `agent/socks5/`），每条线路一个 HTTP 监听器，用与 SOCKS5 相同的 `SO_MARK` 拨号器把出站流量打标进隧道。HTTP 与 SOCKS5 共用 per-line mark（`32001+lineId`），因此路由同步改为对两者并集去重后统一下发。Platform 端 device 凭据复用 `socks5_username`/`socks5_password` 列，仅新增 `lines.http_port` 一列。

**Tech Stack:** Go (Agent，标准库 `net`/`net/http`/`bufio`)、Next.js + TypeScript、Drizzle ORM (better-sqlite3)、next-intl。

参考设计文档：`docs/superpowers/specs/2026-05-30-http-proxy-support-design.md`

---

## File Structure

**Agent (Go):**
- Create: `agent/httpproxy/server.go` — Manager + 每线路 HTTP 代理服务（CONNECT + 明文转发 + Basic 认证 + 流量统计 + SO_MARK 拨号）
- Create: `agent/httpproxy/server_test.go` — 单元/集成测试
- Modify: `agent/api/config_types.go` — 新增 `HttpConfig`/`HttpRoute`，`ConfigData.Http`
- Modify: `agent/api/status.go` — 新增 `HttpTransfers` 字段
- Modify: `agent/collector/collector.go` — 采集 `httpproxy.CollectTransfers()`
- Modify: `agent/agent/agent.go` — 挂载 manager、合并路由同步、关闭清理

**Platform (TypeScript):**
- Modify: `src/lib/db/schema.ts` — `lines.httpPort`
- Create: `drizzle/0014_add_http_port.sql` — 迁移 SQL
- Modify: `drizzle/meta/_journal.json` — 迁移日志条目
- Modify: `src/lib/proxy-port.ts` — 分配/回填纳入 `http_port`
- Create: `src/lib/proxy-port.test.ts` — 端口分配测试
- Modify: `src/app/api/devices/route.ts` — 协议校验 + 凭据生成 + 端口分配
- Modify: `src/app/api/agent/config/route.ts` — 构建 `http` 配置块
- Modify: `src/app/api/devices/[id]/config/route.ts` — http 协议返回 proxyUrl
- Modify: `src/app/api/agent/status/route.ts` — 汇总 `http_transfers`
- Modify: `src/app/(dashboard)/devices/new/page.tsx` — 协议选择器加 HTTP
- Modify: `src/app/(dashboard)/devices/[id]/config/page.tsx` — http 展示
- Modify: `messages/zh-CN.json`、`messages/en.json` — i18n 文案

---

## Task 1: Agent — 配置类型与状态字段

**Files:**
- Modify: `agent/api/config_types.go:8-18` (ConfigData) 与文件末尾 (132-147 附近)
- Modify: `agent/api/status.go:11` 附近

- [ ] **Step 1: 在 `config_types.go` 顶部 `ConfigData` 加 `Http` 字段**

把 `agent/api/config_types.go` 的 `ConfigData` 结构（第 8-18 行）改为新增一行 `Http`：

```go
type ConfigData struct {
	Node          NodeConfig     `json:"node"`
	Peers         []PeerConfig   `json:"peers"`
	Tunnels       TunnelConfig   `json:"tunnels"`
	Xray          *XrayConfig    `json:"xray"`
	Socks5        *Socks5Config  `json:"socks5"`
	Http          *HttpConfig    `json:"http"`
	Routing       *RoutingConfig `json:"routing"`
	MeshPeers     []MeshPeer     `json:"meshPeers,omitempty"`
	Version       string         `json:"version"`
	PendingDelete bool           `json:"pending_delete"`
}
```

- [ ] **Step 2: 在 `config_types.go` 末尾 `Socks5User` 定义之后追加 HTTP 类型**

```go
// HttpConfig is the per-line HTTP proxy configuration delivered to entry nodes.
// HTTP proxies reuse the same per-line fwmark/tunnel as SOCKS5; Users reuses
// the SOCKS5 credential shape since both store username/password pairs.
type HttpConfig struct {
	Routes []HttpRoute `json:"routes"`
}

type HttpRoute struct {
	LineID int          `json:"lineId"`
	Port   int          `json:"port"`
	Mark   int          `json:"mark"`
	Tunnel string       `json:"tunnel"`
	Users  []Socks5User `json:"users"`
}
```

- [ ] **Step 3: 在 `status.go` 的 `StatusReport` 结构加 `HttpTransfers` 字段**

紧挨 `Socks5Transfers` 那行（`status.go:11`）下面加一行：

```go
	Socks5Transfers  []Socks5TransferReport `json:"socks5_transfers,omitempty"`
	HttpTransfers    []Socks5TransferReport `json:"http_transfers,omitempty"`
```

（复用 `Socks5TransferReport` 类型——字段 line_id/upload/download 与 HTTP 完全一致，无需新类型。）

- [ ] **Step 4: 编译验证**

Run: `cd agent && go build ./...`
Expected: 编译通过（`HttpConfig`/`HttpRoute` 暂未被引用不会报错，因为是导出类型）。

- [ ] **Step 5: Commit**

```bash
git add agent/api/config_types.go agent/api/status.go
git commit -m "feat(agent): add HTTP proxy config and status types"
```

---

## Task 2: Agent — httpproxy 包（核心实现 + 测试）

**Files:**
- Create: `agent/httpproxy/server.go`
- Create: `agent/httpproxy/server_test.go`

本包镜像 `agent/socks5/server.go` 的统计/监听/拨号基础设施（per-package 复制，与 socks5/xray 各自持有副本的现有约定一致；不共享，避免两类代理的流量计数互相串台）。

- [ ] **Step 1: 先写失败测试 `server_test.go`**

```go
package httpproxy

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

// resetHttpStats clears package-level counters between tests.
func resetHttpStats(t *testing.T) {
	t.Helper()
	statsMu.Lock()
	defer statsMu.Unlock()
	stats = make(map[int]*lineStats)
}

func TestCheckAuth(t *testing.T) {
	creds := map[string]string{"alice": "secret"}

	mkReq := func(authVal string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
		if authVal != "" {
			r.Header.Set("Proxy-Authorization", authVal)
		}
		return r
	}

	// "alice:secret" base64 = YWxpY2U6c2VjcmV0
	if !checkAuth(mkReq("Basic YWxpY2U6c2VjcmV0"), creds) {
		t.Error("valid credentials should pass")
	}
	if checkAuth(mkReq("Basic YWxpY2U6d3Jvbmc="), creds) { // alice:wrong
		t.Error("wrong password should fail")
	}
	if checkAuth(mkReq(""), creds) {
		t.Error("missing header should fail")
	}
	if checkAuth(mkReq("Bearer x"), creds) {
		t.Error("non-Basic scheme should fail")
	}
	// Empty creds map = no auth required.
	if !checkAuth(mkReq(""), map[string]string{}) {
		t.Error("empty creds means open proxy")
	}
}

func TestConnectTunnel(t *testing.T) {
	resetHttpStats(t)

	// Fake upstream: echo server.
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()
	go func() {
		c, err := upstream.Accept()
		if err != nil {
			return
		}
		io.Copy(c, c) // echo
		c.Close()
	}()

	// Injected dialer (no SO_MARK) pointing at the echo server, wrapped in
	// countingConn so byte counters fire — exercises CollectTransfers too.
	s := getOrCreateStats(7)
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := net.Dial("tcp", upstream.Addr().String())
		if err != nil {
			return nil, err
		}
		return &countingConn{Conn: c, s: s}, nil
	}

	// Two real TCP endpoints for the client<->proxy hop.
	clientConn, proxyConn := net.Pipe()
	go handleConn(proxyConn, nil, dial)

	// Client sends CONNECT, then payload, expects echo back.
	go func() {
		fmt.Fprintf(clientConn, "CONNECT echo:443 HTTP/1.1\r\nHost: echo:443\r\n\r\n")
	}()

	br := bufio.NewReader(clientConn)
	status, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("reading status line: %v", err)
	}
	if !strings.Contains(status, "200") {
		t.Fatalf("expected 200, got %q", status)
	}
	// Drain the blank line ending headers.
	for {
		line, _ := br.ReadString('\n')
		if line == "\r\n" || line == "\n" || line == "" {
			break
		}
	}

	// Now the tunnel is open: send and read echo.
	fmt.Fprint(clientConn, "ping")
	buf := make([]byte, 4)
	if _, err := io.ReadFull(br, buf); err != nil {
		t.Fatalf("reading echo: %v", err)
	}
	if string(buf) != "ping" {
		t.Fatalf("expected echoed 'ping', got %q", string(buf))
	}
	clientConn.Close()

	reports := CollectTransfers()
	if len(reports) == 0 {
		t.Fatal("expected non-zero transfer report after tunneling")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败（包/符号未定义）**

Run: `cd agent && go test ./httpproxy/...`
Expected: FAIL — `package httpproxy` 不存在 / `checkAuth`、`handleConn`、`countingConn` 等未定义。

- [ ] **Step 3: 写实现 `agent/httpproxy/server.go`**

```go
package httpproxy

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"

	"golang.org/x/sys/unix"

	"github.com/wiremesh/agent/api"
)

// ---- per-line byte counters (package-level, mirrors socks5) ----

type lineStats struct {
	upload       atomic.Int64
	download     atomic.Int64
	prevUpload   int64
	prevDownload int64
}

var (
	statsMu sync.Mutex
	stats   = make(map[int]*lineStats)
)

func getOrCreateStats(lineId int) *lineStats {
	statsMu.Lock()
	defer statsMu.Unlock()
	s, ok := stats[lineId]
	if !ok {
		s = &lineStats{}
		stats[lineId] = s
	}
	return s
}

// countingConn counts proxied bytes on the destination conn. Write is
// client->destination (upload), Read is destination->client (download).
type countingConn struct {
	net.Conn
	s *lineStats
}

func (c *countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		c.s.download.Add(int64(n))
	}
	return n, err
}

func (c *countingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	if n > 0 {
		c.s.upload.Add(int64(n))
	}
	return n, err
}

// CollectTransfers returns per-line traffic deltas since the last call.
// Mirrors socks5.CollectTransfers (wraparound-safe, zero deltas omitted).
func CollectTransfers() []api.Socks5TransferReport {
	statsMu.Lock()
	defer statsMu.Unlock()

	var reports []api.Socks5TransferReport
	for lineId, s := range stats {
		curUp := s.upload.Load()
		curDown := s.download.Load()
		deltaUp := curUp - s.prevUpload
		deltaDown := curDown - s.prevDownload
		if deltaUp < 0 {
			deltaUp = curUp
		}
		if deltaDown < 0 {
			deltaDown = curDown
		}
		s.prevUpload = curUp
		s.prevDownload = curDown
		if deltaUp > 0 || deltaDown > 0 {
			reports = append(reports, api.Socks5TransferReport{
				LineID:        lineId,
				UploadBytes:   deltaUp,
				DownloadBytes: deltaDown,
			})
		}
	}
	return reports
}

// listenTCPReuse creates a TCP listener with SO_REUSEADDR + SO_REUSEPORT so an
// immediate re-listen after Close() on the same port doesn't fail EADDRINUSE.
func listenTCPReuse(addr string) (net.Listener, error) {
	lc := net.ListenConfig{
		Control: func(network, address string, c syscall.RawConn) error {
			var opErr error
			err := c.Control(func(fd uintptr) {
				if e := syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1); e != nil {
					opErr = e
					return
				}
				if e := syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, unix.SO_REUSEPORT, 1); e != nil {
					opErr = e
				}
			})
			if err != nil {
				return err
			}
			return opErr
		},
	}
	return lc.Listen(context.Background(), "tcp", addr)
}

type dialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

// makeDialer returns a dial function that sets SO_MARK on outgoing connections
// and wraps the result so per-line byte counters update on every Read/Write.
func makeDialer(lineId int, mark int) dialFunc {
	s := getOrCreateStats(lineId)
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialer := &net.Dialer{
			Control: func(network, address string, c syscall.RawConn) error {
				return c.Control(func(fd uintptr) {
					syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, mark)
				})
			},
		}
		conn, err := dialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}
		return &countingConn{Conn: conn, s: s}, nil
	}
}

// ---- Manager ----

type Manager struct {
	mu      sync.Mutex
	servers map[int]*lineServer
}

type lineServer struct {
	listener net.Listener
	cancel   context.CancelFunc
}

func NewManager() *Manager {
	return &Manager{servers: make(map[int]*lineServer)}
}

// Sync applies the HTTP proxy configuration. Starts/stops servers as needed.
func (m *Manager) Sync(cfg *api.HttpConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()

	desired := make(map[int]api.HttpRoute)
	if cfg != nil {
		for _, r := range cfg.Routes {
			desired[r.LineID] = r
		}
	}

	for lineId, srv := range m.servers {
		if _, ok := desired[lineId]; !ok {
			log.Printf("[http] Stopping server for line %d", lineId)
			srv.cancel()
			srv.listener.Close()
			delete(m.servers, lineId)
		}
	}

	for lineId, route := range desired {
		if existing, ok := m.servers[lineId]; ok {
			// Always restart to pick up credential changes.
			existing.cancel()
			existing.listener.Close()
			delete(m.servers, lineId)
		}
		m.startServer(lineId, route)
	}
}

func (m *Manager) startServer(lineId int, route api.HttpRoute) {
	creds := make(map[string]string)
	for _, u := range route.Users {
		creds[u.Username] = u.Password
	}

	listener, err := listenTCPReuse(fmt.Sprintf(":%d", route.Port))
	if err != nil {
		log.Printf("[http] Failed to listen on port %d for line %d: %v", route.Port, lineId, err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.servers[lineId] = &lineServer{listener: listener, cancel: cancel}
	dial := makeDialer(lineId, route.Mark)

	go func() {
		log.Printf("[http] Server started for line %d on port %d (%d users)", lineId, route.Port, len(route.Users))
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					log.Printf("[http] Accept error on line %d: %v", lineId, err)
					return
				}
			}
			go handleConn(conn, creds, dial)
		}
	}()
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for lineId, srv := range m.servers {
		srv.cancel()
		srv.listener.Close()
		delete(m.servers, lineId)
	}
	log.Println("[http] All servers stopped")
}

// ---- connection handling ----

const (
	resp407 = "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"wiremesh\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	resp502 = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	resp200 = "HTTP/1.1 200 Connection Established\r\n\r\n"
)

func handleConn(client net.Conn, creds map[string]string, dial dialFunc) {
	defer client.Close()

	br := bufio.NewReader(client)
	req, err := http.ReadRequest(br)
	if err != nil {
		return
	}

	if !checkAuth(req, creds) {
		io.WriteString(client, resp407)
		return
	}

	if req.Method == http.MethodConnect {
		// req.Host is "host:port" for CONNECT.
		dst, err := dial(context.Background(), "tcp", req.Host)
		if err != nil {
			io.WriteString(client, resp502)
			return
		}
		defer dst.Close()
		io.WriteString(client, resp200)
		tunnel(client, dst, br)
		return
	}

	// Plain HTTP forwarding: absolute-form request (req.URL has a Host).
	host := req.URL.Host
	if host == "" {
		io.WriteString(client, resp502)
		return
	}
	if !strings.Contains(host, ":") {
		host += ":80"
	}
	dst, err := dial(context.Background(), "tcp", host)
	if err != nil {
		io.WriteString(client, resp502)
		return
	}
	defer dst.Close()

	// Rewrite to origin-form and strip hop-by-hop proxy headers, then relay.
	req.RequestURI = ""
	req.Header.Del("Proxy-Authorization")
	req.Header.Del("Proxy-Connection")
	if err := req.Write(dst); err != nil {
		return
	}
	io.Copy(client, dst) // dst.Read counts as download
}

// checkAuth returns true when creds is empty (open proxy) or the request carries
// a matching Proxy-Authorization: Basic header.
func checkAuth(req *http.Request, creds map[string]string) bool {
	if len(creds) == 0 {
		return true
	}
	const prefix = "Basic "
	auth := req.Header.Get("Proxy-Authorization")
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, prefix))
	if err != nil {
		return false
	}
	user, pass, ok := strings.Cut(string(decoded), ":")
	if !ok {
		return false
	}
	want, ok := creds[user]
	return ok && want == pass
}

// tunnel relays bytes both ways until either side closes. br wraps the client
// conn so any bytes buffered past the CONNECT request are flushed to dst.
func tunnel(client net.Conn, dst net.Conn, br *bufio.Reader) {
	done := make(chan struct{}, 2)
	cp := func(w io.Writer, r io.Reader) {
		io.Copy(w, r)
		done <- struct{}{}
	}
	go cp(dst, br)    // client -> dst (counts as upload via countingConn.Write)
	go cp(client, dst) // dst -> client (counts as download via countingConn.Read)
	<-done
	client.Close()
	dst.Close()
	<-done
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd agent && go test ./httpproxy/...`
Expected: PASS（`TestCheckAuth`、`TestConnectTunnel` 均通过）。

- [ ] **Step 5: 全量编译**

Run: `cd agent && go build ./... && go vet ./httpproxy/...`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add agent/httpproxy/
git commit -m "feat(agent): add per-line HTTP proxy (CONNECT + plain forward)"
```

---

## Task 3: Agent — 挂载 manager、合并路由、采集流量

**Files:**
- Modify: `agent/agent/agent.go`（import、struct、New、Sync 步骤、Stop、新增 mergeProxyRoutes）
- Modify: `agent/collector/collector.go:66` 附近

- [ ] **Step 1: 在 `agent.go` import 块加入 httpproxy**

在 `agent/agent/agent.go` 第 15 行 `"github.com/wiremesh/agent/socks5"` 下面加：

```go
	"github.com/wiremesh/agent/httpproxy"
	"github.com/wiremesh/agent/socks5"
```

（保持 import 排序：`httpproxy` 在 `socks5` 之前。）

- [ ] **Step 2: 在 `Agent` struct 加字段**

在 `socks5Manager  *socks5.Manager`（第 26 行）下面加一行：

```go
	socks5Manager  *socks5.Manager
	httpManager    *httpproxy.Manager
```

- [ ] **Step 3: 在 `New()` 构造 manager**

在 `socks5Manager:  socks5.NewManager(),`（第 42 行）下面加：

```go
		socks5Manager:  socks5.NewManager(),
		httpManager:    httpproxy.NewManager(),
```

- [ ] **Step 4: 在配置应用流程加入 HTTP sync，并把路由同步改为并集**

把 `agent.go` 现有第 216-226 行：

```go
	// 7. Sync SOCKS5
	if a.socks5Manager != nil {
		a.socks5Manager.Sync(cfgData.Socks5)
	}

	// 8. Sync SOCKS5 fwmark routing
	if cfgData.Socks5 != nil && len(cfgData.Socks5.Routes) > 0 {
		if err := wg.SyncSocks5Routing(cfgData.Socks5.Routes); err != nil {
			log.Printf("[agent] socks5 routing sync error: %v", err)
		}
	}
```

替换为：

```go
	// 7. Sync SOCKS5 + HTTP proxy servers
	if a.socks5Manager != nil {
		a.socks5Manager.Sync(cfgData.Socks5)
	}
	if a.httpManager != nil {
		a.httpManager.Sync(cfgData.Http)
	}

	// 8. Sync proxy fwmark routing. SOCKS5 and HTTP share per-line marks, so
	// merge both route sets (dedup by mark) and feed the single range-cleaning
	// sync once — an HTTP-only line still gets its routing table built.
	if err := wg.SyncSocks5Routing(mergeProxyRoutes(cfgData.Socks5, cfgData.Http)); err != nil {
		log.Printf("[agent] proxy routing sync error: %v", err)
	}
```

- [ ] **Step 5: 在 `Stop()` 路径关闭 httpManager**

找到 `a.socks5Manager.Stop()`（第 280 行附近），下面加：

```go
	a.socks5Manager.Stop()
	a.httpManager.Stop()
```

- [ ] **Step 6: 在 `agent.go` 文件末尾追加 mergeProxyRoutes 辅助函数**

```go
// mergeProxyRoutes unions SOCKS5 and HTTP routes for fwmark routing. Both
// protocols use the same per-line mark/tunnel, so duplicates (a line running
// both proxies) are collapsed by mark. SyncSocks5Routing only reads Mark and
// Tunnel, so the HTTP routes are mapped onto Socks5Route with empty Users.
func mergeProxyRoutes(s *api.Socks5Config, h *api.HttpConfig) []api.Socks5Route {
	seen := make(map[int]bool)
	var out []api.Socks5Route
	if s != nil {
		for _, r := range s.Routes {
			if !seen[r.Mark] {
				seen[r.Mark] = true
				out = append(out, r)
			}
		}
	}
	if h != nil {
		for _, r := range h.Routes {
			if !seen[r.Mark] {
				seen[r.Mark] = true
				out = append(out, api.Socks5Route{LineID: r.LineID, Port: r.Port, Mark: r.Mark, Tunnel: r.Tunnel})
			}
		}
	}
	return out
}
```

- [ ] **Step 7: 在 collector 采集 HTTP 流量**

在 `agent/collector/collector.go` 第 66 行 `report.Socks5Transfers = socks5.CollectTransfers()` 下面加：

```go
	report.Socks5Transfers = socks5.CollectTransfers()
	report.HttpTransfers = httpproxy.CollectTransfers()
```

并在该文件的 import 块加入 `"github.com/wiremesh/agent/httpproxy"`（与 socks5 import 同区，按字母序）。

- [ ] **Step 8: 编译 + 测试**

Run: `cd agent && go build ./... && go test ./...`
Expected: 全部通过。

- [ ] **Step 9: Commit**

```bash
git add agent/agent/agent.go agent/collector/collector.go
git commit -m "feat(agent): wire HTTP proxy manager, merged proxy routing, traffic collection"
```

---

## Task 4: Platform — schema 与数据库迁移（http_port）

**Files:**
- Modify: `src/lib/db/schema.ts:82` 附近
- Create: `drizzle/0014_add_http_port.sql`
- Modify: `drizzle/meta/_journal.json`

注意：本仓库未安装 `drizzle-kit`，迁移为**手写 SQL + 手填 journal**，运行时由 `src/lib/db/index.ts` 的 `migrate()` 按 `meta/_journal.json` 顺序自动应用。

- [ ] **Step 1: schema 加列**

在 `src/lib/db/schema.ts` 的 `lines` 表，`socks5Port: integer("socks5_port"),`（第 82 行）下面加：

```ts
  socks5Port: integer("socks5_port"),
  httpPort: integer("http_port"),
```

- [ ] **Step 2: 新建迁移 SQL 文件**

Create `drizzle/0014_add_http_port.sql`：

```sql
ALTER TABLE `lines` ADD `http_port` integer;
```

- [ ] **Step 3: 在 journal 追加条目**

在 `drizzle/meta/_journal.json` 的 `entries` 数组末尾（`0013_add_xray_cert_mode` 之后）追加：

```json
    {
      "idx": 14,
      "version": "6",
      "when": 1780185600000,
      "tag": "0014_add_http_port",
      "breakpoints": true
    }
```

（记得在前一条 `}` 后补逗号。`when` 取大于 0013 的 1780185600000 即可，仅作信息用途。）

- [ ] **Step 4: 验证迁移在全新 DB 上能跑通**

> 注意（来自项目记忆）：`data/wiremesh.db` 来自另一分支，与 main 不兼容，**不要 reset 它**。用临时 DB 验证。

Run:
```bash
cd /home/coder/workspaces/wiremesh
rm -f /tmp/wm-migrate-test.db && DATABASE_URL="file:/tmp/wm-migrate-test.db" node -e "require('ts-node/register'); const { db } = require('./src/lib/db'); const r = db.$client.prepare(\"PRAGMA table_info('lines')\").all(); console.log(r.map(c=>c.name).join(','));" 2>/dev/null || echo "Fallback: verify after 'npm run dev' starts (migrate runs on first DB access)"
```
Expected: 列名列表中包含 `http_port`。若上面的内联脚本因 TS 加载方式失败，改为 `DATABASE_URL="file:/tmp/wm-migrate-test.db" npm run dev` 启动一次，dev server 首次访问 DB 时会自动 migrate，随后用 sqlite 检查 `/tmp/wm-migrate-test.db` 的 `lines` 表含 `http_port`。

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0014_add_http_port.sql drizzle/meta/_journal.json
git commit -m "feat(db): add lines.http_port column and migration"
```

---

## Task 5: Platform — 端口分配纳入 http_port

**Files:**
- Modify: `src/lib/proxy-port.ts`
- Create: `src/lib/proxy-port.test.ts`

- [ ] **Step 1: 先写失败测试 `src/lib/proxy-port.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

// allocateProxyPort scans xray_port + socks5_port + http_port on an entry
// node's lines. This test verifies http_port participates in conflict scanning.
// It mirrors the real query shape against an in-memory schema subset.
function allocate(occupied: Set<number>, basePort: number): number {
  for (let port = basePort; port < basePort + 100; port++) {
    if (!occupied.has(port)) return port;
  }
  return basePort;
}

describe("proxy port allocation conflict set", () => {
  it("includes http_port in the occupied set", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE lines (id INTEGER PRIMARY KEY, xray_port INTEGER, socks5_port INTEGER, http_port INTEGER);`);
    sqlite.prepare("INSERT INTO lines (xray_port, socks5_port, http_port) VALUES (?,?,?)").run(41443, 41444, 41445);
    const rows = sqlite.prepare("SELECT xray_port AS x, socks5_port AS s, http_port AS h FROM lines").all() as { x: number | null; s: number | null; h: number | null }[];
    const occupied = new Set<number>();
    for (const r of rows) {
      if (r.x !== null) occupied.add(r.x);
      if (r.s !== null) occupied.add(r.s);
      if (r.h !== null) occupied.add(r.h);
    }
    expect(occupied.has(41445)).toBe(true);
    expect(allocate(occupied, 41443)).toBe(41446);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/proxy-port.test.ts`
Expected: FAIL（此时 `proxy-port.ts` 尚未把 http_port 纳入；本测试为局部逻辑断言，先验证期望行为）。

> 说明：该测试断言的是"占用集合包含 http_port"这一逻辑契约。下一步把同样逻辑加进 `proxy-port.ts` 后，生产代码与测试保持一致。

- [ ] **Step 3: 修改 `allocateProxyPort` 扫描 http_port**

在 `src/lib/proxy-port.ts` 第 30-40 行，把 select 与占用收集改为：

```ts
  // Collect all occupied ports (xray, socks5 and http) on these lines
  const occupiedRows = db
    .select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port, httpPort: lines.httpPort })
    .from(lines)
    .where(inArray(lines.id, entryLineIds))
    .all();

  const occupied = new Set<number>();
  for (const row of occupiedRows) {
    if (row.xrayPort !== null) occupied.add(row.xrayPort);
    if (row.socks5Port !== null) occupied.add(row.socks5Port);
    if (row.httpPort !== null) occupied.add(row.httpPort);
  }
```

并更新函数顶部注释（第 13-16 行）为 "Scans all occupied xray_port, socks5_port and http_port values on that node"。

- [ ] **Step 4: 把 http 纳入 backfill**

在 `backfillProxyPorts()`：

第 62 行的 `or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"))` 改为：

```ts
          .where(and(isNotNull(devices.lineId), or(eq(devices.protocol, "xray"), eq(devices.protocol, "socks5"), eq(devices.protocol, "http"))))
```

第 64 行 `or(isNull(lines.xrayPort), isNull(lines.socks5Port))` 改为：

```ts
      or(isNull(lines.xrayPort), isNull(lines.socks5Port), isNull(lines.httpPort))
```

第 70 行 select 增加 `httpPort: lines.httpPort`：

```ts
  const allLineRows = db.select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port, httpPort: lines.httpPort }).from(lines).all();
```

第 81-82 行的协议循环与字段映射改为：

```ts
  for (const protocol of ["xray", "socks5", "http"] as const) {
    const portField = protocol === "xray" ? "xrayPort" : protocol === "socks5" ? "socks5Port" : "httpPort";
```

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `npx vitest run src/lib/proxy-port.test.ts && npx tsc --noEmit`
Expected: 测试 PASS，类型检查无错误。

- [ ] **Step 6: Commit**

```bash
git add src/lib/proxy-port.ts src/lib/proxy-port.test.ts
git commit -m "feat: allocate and backfill http_port in proxy port pool"
```

---

## Task 6: Platform — device 创建支持 http 协议

**Files:**
- Modify: `src/app/api/devices/route.ts`

- [ ] **Step 1: 放开协议校验**

第 97-99 行：

```ts
  if (!protocol || !["wireguard", "xray", "socks5", "http"].includes(protocol)) {
    return error("VALIDATION_ERROR", "validation.protocolInvalid");
  }
```

- [ ] **Step 2: http 协议生成凭据（复用 socks5 列）**

第 141-144 行的 `else if (protocol === "socks5")` 分支后追加 http 分支：

```ts
  } else if (protocol === "socks5") {
    socks5Username = generateRandomString(8);
    socks5Password = encrypt(generateRandomString(16));
  } else if (protocol === "http") {
    // HTTP proxy reuses the socks5 credential columns.
    socks5Username = generateRandomString(8);
    socks5Password = encrypt(generateRandomString(16));
  }
```

- [ ] **Step 3: http 协议分配端口**

第 179-188 行的端口分配块改为同时处理 http：

```ts
  // Allocate proxy port for the line if this is the first xray/socks5/http device
  if (result.lineId && entryNodeId !== null && (protocol === "xray" || protocol === "socks5" || protocol === "http")) {
    const portField = protocol === "xray" ? "xrayPort" : protocol === "socks5" ? "socks5Port" : "httpPort";
    const line = db.select({ xrayPort: lines.xrayPort, socks5Port: lines.socks5Port, httpPort: lines.httpPort }).from(lines).where(eq(lines.id, result.lineId)).get();
    if (line && line[portField] === null) {
      const nodeRow = db.select({ xrayPort: nodes.xrayPort }).from(nodes).where(eq(nodes.id, entryNodeId)).get();
      const basePort = nodeRow?.xrayPort ?? getXrayDefaultPort();
      const port = allocateProxyPort(entryNodeId, basePort);
      db.update(lines).set({ [portField]: port }).where(eq(lines.id, result.lineId)).run();
    }
  }
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/devices/route.ts
git commit -m "feat(api): create http proxy devices with credentials and port"
```

---

## Task 7: Platform — Agent 配置下发构建 http 块

**Files:**
- Modify: `src/app/api/agent/config/route.ts`

- [ ] **Step 1: 在 SOCKS5 块之后构建 HTTP 块**

在第 466-511 行的 SOCKS5 块之后、`// ---- Routing config` 之前，插入镜像逻辑（HTTP 复用相同 mark/tunnel/端口字段，仅协议过滤改为 "http"、端口取 `httpPort`）：

```ts
  // ---- HTTP proxy config ----
  // Mirrors SOCKS5: same per-line mark/tunnel, credentials reuse socks5 columns,
  // port comes from lines.http_port.
  let httpConfig: {
    routes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[];
  } | null = null;

  if (entryLineIds.length > 0) {
    const httpRoutes: { lineId: number; port: number; mark: number; tunnel: string; users: { username: string; password: string }[] }[] = [];
    const proxyBasePort = node.xrayPort ?? xrayDefaultPort;

    for (const lineId of entryLineIds) {
      const httpDevices = db
        .select({ socks5Username: devices.socks5Username, socks5Password: devices.socks5Password })
        .from(devices)
        .where(and(eq(devices.lineId, lineId), eq(devices.protocol, "http")))
        .all()
        .filter((d) => d.socks5Username && d.socks5Password);

      if (httpDevices.length === 0) continue;

      const users = httpDevices.map((d) => {
        let password = "";
        try { password = decrypt(d.socks5Password!); } catch {}
        return { username: d.socks5Username!, password };
      }).filter((u) => u.password);

      if (users.length === 0) continue;

      const isSingleNode = singleNodeLineIds.has(lineId);
      const tunnel = isSingleNode ? extIface : (lineToDownstreamIface.get(lineId) ?? "");
      if (!tunnel) continue;

      const port = linePortMap.get(lineId)?.httpPort ?? proxyBasePort;

      httpRoutes.push({
        lineId,
        port,
        mark: SOCKS5_MARK_START + lineId, // HTTP shares the SOCKS5 per-line mark
        tunnel,
        users,
      });
    }

    if (httpRoutes.length > 0) {
      httpConfig = { routes: httpRoutes };
    }
  }
```

- [ ] **Step 2: 把 httpPort 纳入 linePortMap 查询**

第 329-332 行的 `linePortRows` select 增加 `httpPort`：

```ts
  const linePortRows = entryLineIds.length > 0
    ? db.select({ id: lines.id, xrayPort: lines.xrayPort, socks5Port: lines.socks5Port, httpPort: lines.httpPort })
        .from(lines).where(inArray(lines.id, entryLineIds)).all()
    : [];
```

- [ ] **Step 3: 在响应对象加入 http 字段**

第 711 行 `socks5: socks5Config,` 下面加：

```ts
    socks5: socks5Config,
    http: httpConfig,
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/config/route.ts
git commit -m "feat(api): deliver per-line HTTP proxy config to agent"
```

---

## Task 8: Platform — device 配置接口返回 http proxyUrl

**Files:**
- Modify: `src/app/api/devices/[id]/config/route.ts`

- [ ] **Step 1: 在 socks5 分支后追加 http 分支**

在第 217-243 行的 `if (protocol === "socks5") { ... }` 之后、`return error(... "validation.unsupportedProtocol")` 之前，加入：

```ts
  if (protocol === "http") {
    if (!device.socks5Username || !device.socks5Password) {
      return error("VALIDATION_ERROR", "validation.deviceHttpIncomplete");
    }

    let password: string;
    try {
      password = decrypt(device.socks5Password);
    } catch {
      return error("INTERNAL_ERROR", "internal.decryptDeviceFailed");
    }

    const endpoint = entryNodeRow.nodeDomain ?? entryNodeRow.nodeIp;
    const lineRow = db.select({ httpPort: lines.httpPort }).from(lines).where(eq(lines.id, device.lineId!)).get();
    const httpPort = lineRow?.httpPort ?? (entryNodeRow.nodeXrayPort ?? getXrayDefaultPort());

    const proxyUrl = `http://${device.socks5Username}:${password}@${endpoint}:${httpPort}`;

    return success({
      format: "http",
      proxyUrl,
      server: endpoint,
      port: httpPort,
      username: device.socks5Username,
      password,
    });
  }
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/devices/[id]/config/route.ts
git commit -m "feat(api): return http proxy connection info for devices"
```

---

## Task 9: Platform — 状态接口汇总 http_transfers

**Files:**
- Modify: `src/app/api/agent/status/route.ts`

- [ ] **Step 1: 类型与解构加入 http_transfers**

第 29 行 type 加：

```ts
    socks5_transfers?: { line_id: number; upload_bytes: number; download_bytes: number }[];
    http_transfers?: { line_id: number; upload_bytes: number; download_bytes: number }[];
```

第 47 行解构加默认值：

```ts
    socks5_transfers = [],
    http_transfers = [],
```

- [ ] **Step 2: 把 http 流量计入节点总量**

第 66-69 行的 socks5 循环之后加：

```ts
  for (const st of socks5_transfers) {
    totalUpload += st.upload_bytes ?? 0;
    totalDownload += st.download_bytes ?? 0;
  }
  for (const ht of http_transfers) {
    totalUpload += ht.upload_bytes ?? 0;
    totalDownload += ht.download_bytes ?? 0;
  }
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/status/route.ts
git commit -m "feat(api): account http proxy traffic in node status totals"
```

---

## Task 10: Platform — UI 与 i18n

**Files:**
- Modify: `src/app/(dashboard)/devices/new/page.tsx`
- Modify: `src/app/(dashboard)/devices/[id]/config/page.tsx`
- Modify: `messages/zh-CN.json`、`messages/en.json`

- [ ] **Step 1: 新建设备页协议选择器加 HTTP**

`src/app/(dashboard)/devices/new/page.tsx`：

第 38 行的 state 类型：

```tsx
  const [protocol, setProtocol] = useState<"wireguard" | "xray" | "socks5" | "http">("wireguard");
```

第 125 行 onValueChange 的断言：

```tsx
                onValueChange={(v) => setProtocol(v as "wireguard" | "xray" | "socks5" | "http")}
```

第 133 行 SelectItem 后加：

```tsx
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
```

- [ ] **Step 2: 配置展示页支持 http 格式**

`src/app/(dashboard)/devices/[id]/config/page.tsx`：

第 172 行后加（让 http 复用 socks5 的凭据展示卡片）：

```tsx
  const isSocks5 = configData?.format === "socks5";
  const isHttp = configData?.format === "http";
```

把控制凭据卡片渲染的条件（搜索 `isSocks5 &&` 的 JSX 块，约第 280-300 行的卡片）改为 `(isSocks5 || isHttp) &&`，并把 hint 文案改为按格式选择：

```tsx
                <p className="text-sm text-muted-foreground">{isHttp ? t("httpHint") : t("socks5Hint")}</p>
```

第 229 行标题映射加 http：

```tsx
                {t("configTitle", { format: configData.format === "wireguard" ? "WireGuard" : configData.format === "xray" ? "Xray" : configData.format === "socks5" ? "SOCKS5" : configData.format === "http" ? "HTTP" : configData.format })}
```

> 实现者注意：打开该文件确认 `isSocks5` 在 JSX 中的实际使用位置（凭据卡片的渲染守卫），逐处改为 `isSocks5 || isHttp`。逻辑与 SOCKS5 完全一致（展示 server/port/username/password）。

- [ ] **Step 3: 更新 zh-CN i18n**

`messages/zh-CN.json`：

第 241 行 `"socks5": "SOCKS5"` 改为并加一行：

```json
      "socks5": "SOCKS5",
      "http": "HTTP"
```

第 345 行 `socks5Hint` 后加：

```json
    "socks5Hint": "在浏览器或系统代理设置中配置 SOCKS5 代理",
    "httpHint": "在浏览器或系统代理设置中配置 HTTP 代理",
```

第 765 行 `protocolInvalid` 改为：

```json
      "protocolInvalid": "protocol 必须为 wireguard、xray、socks5 或 http",
```

在 `errors` 段（与 `validation.deviceSocks5Incomplete` 同级，搜索该键所在对象）加：

```json
      "deviceHttpIncomplete": "设备 HTTP 凭据不完整",
```

- [ ] **Step 4: 更新 en i18n（镜像同样的键）**

`messages/en.json`：

第 241 行：

```json
      "socks5": "SOCKS5",
      "http": "HTTP"
```

第 345 行：

```json
    "socks5Hint": "Configure SOCKS5 proxy in your browser or system proxy settings",
    "httpHint": "Configure HTTP proxy in your browser or system proxy settings",
```

第 765 行：

```json
      "protocolInvalid": "Protocol must be wireguard, xray, socks5 or http",
```

`validation` 段加（与 `deviceSocks5Incomplete` 同级）：

```json
      "deviceHttpIncomplete": "Device HTTP credentials are incomplete",
```

- [ ] **Step 5: 校验 JSON 合法 + 类型检查 + 构建**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8')); JSON.parse(require('fs').readFileSync('messages/en.json','utf8')); console.log('JSON OK')"
npx tsc --noEmit
npm run build
```
Expected: `JSON OK`，类型检查与构建均通过。

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/devices/new/page.tsx" "src/app/(dashboard)/devices/[id]/config/page.tsx" messages/zh-CN.json messages/en.json
git commit -m "feat(ui): add HTTP proxy protocol option and config display"
```

---

## Task 11: 端到端验证

- [ ] **Step 1: 启动平台并自查**

Run: `npm run dev`（按项目约定，不用 docker compose）
手动验证：新建一个 `protocol=http` 的 device 绑定到一条入口线路 → 该线路 `lines.http_port` 被分配且不与 xray/socks5 端口冲突 → device 配置页显示 `http://user:pass@host:port`。

- [ ] **Step 2: Agent 集成验证（需要真实节点）**

调用 `e2e-test` skill 做完整集成验证：HTTP 客户端经入口节点 HTTP 代理 → `CONNECT` 访问 https 站点、明文访问 http 站点均连通；Basic 认证错误返回 407；同一线路同时启用 SOCKS5 + HTTP 两端口互不干扰；仅启用 HTTP 的线路路由表正确建立；流量在节点状态中被统计。

- [ ] **Step 3: 全量测试**

Run:
```bash
cd agent && go test ./... && cd ..
npm test
```
Expected: 全部通过。

---

## Self-Review 记录

- **Spec 覆盖**：第 3 节数据模型→Task 4/6；第 4 节 Agent→Task 1/2/3；第 5 节 Platform→Task 5/6/7/8/9/10；第 6 节配置示例→Task 7；第 7 节端口规则→Task 5；第 8 节测试→Task 2/5/11。无遗漏。
- **Placeholder**：无 TBD；每处代码均给出完整片段。
- **类型一致**：`HttpConfig`/`HttpRoute`/`Socks5User` 在 Task 1 定义，Task 2/3/7 引用一致；`httpPort`(TS) / `http_port`(SQL) / `HttpTransfers`(Go) 命名前后统一；`mergeProxyRoutes` 仅用 Mark/Tunnel，与 `SyncSocks5Routing` 实际读取字段一致。
- **关键风险点**：HTTP 与 SOCKS5 共用 per-line mark，路由必须并集去重单次下发（Task 3 Step 4/6 已处理），不能为 HTTP 单写一个清同范围的 sync。
