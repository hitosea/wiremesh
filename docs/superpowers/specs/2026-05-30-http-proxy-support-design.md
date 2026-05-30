# HTTP 代理支持 — 设计文档

日期：2026-05-30
状态：已确认，待实现计划

## 1. 目标

让入口节点在现有 SOCKS5 之外，再支持 **HTTP 代理**，作为与 SOCKS5 平级的 device 协议。HTTP 代理行为对齐 SOCKS5：同时支持 `CONNECT` 隧道（https 等任意 TCP）和明文 HTTP 转发（绝对 URI 的 `GET http://...`），保证客户端配置 HTTP 代理后"什么都能跑"。

## 2. 核心约束与复用结论

WireMesh 的代理基础设施大部分是**协议无关**的，HTTP 代理直接复用，不重新发明：

- **SO_MARK 打标 + per-line fwmark 路由**：mark 按线路计算（`SOCKS5_MARK_START + lineId`，即 32001+lineId），路由表同理。**不区分协议**——同一条线路的 SOCKS5 与 HTTP 走同一个 mark、同一张路由表、同一个隧道。
- **凭据加密**：AES-256-GCM（`src/lib/crypto.ts`），协议无关。
- **凭据字段复用**：HTTP device 的账号密码直接存进现有 `devices.socks5_username` / `devices.socks5_password`，**不新增列**。
- **流量统计**：`countingConn` 模式协议无关，直接复用。
- **配置下发 / 生命周期**：Agent 每次拉取配置后幂等重建，HTTP 复用同一套 `Manager.Sync/Stop/CollectTransfers` 模式。

唯一绕不开的新增字段：`lines.http_port`（因为同一线路 SOCKS5 与 HTTP 是两个独立监听器，必须各占一个端口）。

## 3. 数据模型变更

### `lines` 表
- 新增 `http_port`（nullable integer），与现有 `socks5_port`（`schema.ts:82`）平级。

### `devices` 表
- `protocol` 枚举（`schema.ts:128`）新增取值 `"http"`，与 `"socks5"` / `"xray"` / `"wireguard"` 平级。
- **凭据列零新增**：复用 `socks5_username` / `socks5_password`。

## 4. Agent 端（Go）

### 新建 `agent/httpproxy/` 包
镜像 `agent/socks5/` 结构：

- **`Manager`**：`Sync(cfg *api.HttpConfig)` / `Stop()` / `CollectTransfers()`，接口与 `socks5.Manager` 一致。在 `agent/agent/agent.go` 中并排挂一个 `httpProxyManager`（构造、Sync、Stop、状态上报各处镜像 socks5）。
- **`server.go`**：每条线路一个 HTTP 监听器，端口复用 `listenTCPReuse`（SO_REUSEPORT）。连接处理：
  1. 读请求行 + 头部，解析 `Proxy-Authorization: Basic`。凭据列表非空时校验，失败回 `407 Proxy Authentication Required` + `Proxy-Authenticate: Basic`。
  2. **`CONNECT host:port`**：用带 SO_MARK 的拨号器拨目标 → 回 `200 Connection Established` → 双向 `io.Copy`。
  3. **明文绝对 URI（`GET http://host/...`）**：拨目标 host → 将请求改写为 origin-form 转发 → 回传响应。简单版按单请求处理，不做连接复用（keep-alive）。
  4. 出站连接外层包 `countingConn` 做流量统计。
- **拨号器**：复用 SOCKS5 的 `makeDialer(lineId, mark)` 模式（`syscall.SO_MARK` 注入）。可抽成共享 helper 或在新包内复制这一小段。

### 配置类型 `agent/api/config_types.go`
新增（结构与 `Socks5Route` 对齐，`Users` 复用 `Socks5User`）：

```go
type HttpConfig struct {
    Routes []HttpRoute `json:"routes"`
}
type HttpRoute struct {
    LineId int          `json:"lineId"`
    Port   int          `json:"port"`
    Mark   int          `json:"mark"`
    Tunnel string       `json:"tunnel"`
    Users  []Socks5User `json:"users"`
}
```
顶层 config data 新增 `Http *HttpConfig`。

### 路由同步（关键点）
`SyncSocks5Routing` 的语义是"清掉自己那段 mark 范围再重建"（`agent.go:209` 注释）。HTTP 与 SOCKS5 **共用同一段 per-line mark**，因此**不能**为 HTTP 单独再写一个清同一范围的 `SyncHttpRouting`，否则两者互相清掉。

做法：在 `agent.go` 第 8 步，将 `cfgData.Socks5.Routes` 与 `cfgData.Http.Routes` 合成**按 (mark, table) 去重的并集**，喂给同一个路由同步函数（把 `SyncSocks5Routing` 泛化为接收合并后的 proxy route 列表）。这样"只开 HTTP 不开 SOCKS5"的线路也能正确建表。

## 5. Platform 端（TypeScript）

| 文件 | 改动 |
|------|------|
| `src/lib/proxy-port.ts` | `allocateProxyPort` 占用扫描加入 `lines.http_port`（第 31、39 行附近）；`backfillProxyPorts` 的协议循环加入 `"http"` → `httpPort` |
| `src/app/api/devices/route.ts` | 新增 `protocol === "http"` 分支：复用现有凭据生成（`socks5_username`/`socks5_password`），在线路上 `allocateProxyPort` 并写入 `lines.http_port`（镜像 socks5 那段逻辑） |
| `src/app/api/agent/config/route.ts` | 构建 `http` 配置块：选 `protocol="http"` 的 device、解密密码、带 `port=lines.http_port` / `mark` / `tunnel`；无入口 HTTP device 时 `http: null` |
| `src/app/api/devices/[id]/config/route.ts` | http 协议返回 `http://user:pass@host:port` proxyUrl 及分字段 |
| `src/app/api/agent/status`（POST） | 处理 `http_transfers` per line，镜像 `socks5_transfers` |
| UI（device 新建/详情页） | 协议选择器加 HTTP 选项；配置页展示 HTTP 凭据 |
| `messages/zh-CN.json` / `messages/en.json` | 新增 UI/校验文案，全部走 `useTranslations()`，不硬编码 |

## 6. 配置下发示例（GET /api/agent/config 响应片段）

```json
{
  "data": {
    "socks5": { "routes": [ ... ] },
    "http": {
      "routes": [
        {
          "lineId": 5,
          "port": 41445,
          "mark": 32006,
          "tunnel": "wm-tun3",
          "users": [ { "username": "abc12345", "password": "<decrypted>" } ]
        }
      ]
    }
  }
}
```

## 7. 端口分配规则（重申）

- Xray / SOCKS5 / HTTP **共用同一端口池**，从 41443 起（`DEFAULT_PROXY_PORT`），按入口节点扫描所有已占用的 `xray_port` + `socks5_port` + `http_port`，取第一个空闲端口。
- 端口在该线路首次创建对应协议 device 时分配，持久化到 `lines.http_port`。

## 8. 测试要点

- `CONNECT` 隧道：https 客户端 → HTTP 代理 → 隧道 → 出口节点，验证打标路由生效。
- 明文转发：http:// 站点经代理可访问。
- `Proxy-Authorization` 校验：错误凭据返回 407，正确放行。
- 凭据加解密（复用列）正确。
- 同一线路 SOCKS5 + HTTP 并存：两个端口、同一路由表、互不干扰。
- 只开 HTTP 不开 SOCKS5 的线路：路由表正确建立（验证并集路由同步）。
- 端口冲突：HTTP 端口分配避开已占用的 xray/socks5/http 端口。

## 9. 工作量评估

中等偏低。路由 / 加密 / 端口分配 / 生命周期全部复用；新增工作集中在 Agent 的 HTTP 协议处理（CONNECT + 明文转发，约 150 行）与 Platform 的镜像改动（device 分支、config 构建、UI、i18n）。
