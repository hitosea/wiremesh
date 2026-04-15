# Xray WebSocket + TLS 传输支持

## 背景

当前 WireMesh 的 Xray 入口层仅支持 VLESS + TCP + REALITY 协议。国内云服务器（阿里云、腾讯云等）作为入口节点时，非标端口的 REALITY 连接容易被云厂商或中间设备拦截，导致 Xray 协议无法使用。

WebSocket + TLS 是 Xray 社区最成熟的替代方案：流量伪装成普通 HTTPS WebSocket 连接，兼容所有主流客户端，不会被拦截。

## 设计目标

- 在节点级别支持选择 REALITY 或 WebSocket+TLS 传输方式，两者共存
- 支持自动申请（Let's Encrypt HTTP-01）和手动上传两种证书管理方式
- Xray 自身处理 TLS + WebSocket，不依赖 Nginx
- WebSocket path 系统自动生成，端口逻辑不变

## 数据层

### 节点表 `nodes` 字段变更

| 字段 | 类型 | 说明 |
|------|------|------|
| `xrayTransport` | text | **已有字段，激活使用**。`"reality"` (默认) 或 `"ws-tls"` |
| `xrayWsPath` | text | **新增**。随机路径（如 `/a3f8b2c1`），创建节点时自动生成 |
| `xrayTlsDomain` | text | **新增**。TLS 域名，选择 WS+TLS 时必填 |
| `xrayTlsCert` | text | **新增**。TLS 证书 PEM 内容，手动上传或自动申请后回填 |
| `xrayTlsKey` | text | **新增**。TLS 私钥 PEM 内容，AES-256-GCM 加密存储 |

### 传输方式与字段关系

- **REALITY 模式**：使用 `xrayConfig` 中的 realityPrivateKey、realityShortId、realityDest、realityServerNames，新字段不使用
- **WS+TLS 模式**：使用 `xrayTlsDomain`、`xrayTlsCert`、`xrayTlsKey`、`xrayWsPath`，REALITY 字段不使用
- 两套配置互不干扰，切换传输方式不会丢失另一套的配置

### 证书管理方式判断

不设独立的模式字段，由内容判断：

- 有 `xrayTlsDomain` 且无 `xrayTlsCert` → 自动申请模式，Agent 通过 ACME HTTP-01 申请证书
- 有 `xrayTlsDomain` 且有 `xrayTlsCert` → 手动上传模式（或自动申请后已回填）

### 节点创建时的默认值

- `xrayTransport`：默认 `"reality"`（保持现有行为）
- `xrayWsPath`：创建节点时自动生成 8 位随机十六进制字符串，前缀 `/`（如 `/a3f8b2c1`）

## 配置生成层

### 平台 → Agent 配置下发

`GET /api/agent/config` 返回的 `xrayConfig` 根据节点 `xrayTransport` 动态生成。

**REALITY 模式（不变）：**

```json
{
  "enabled": true,
  "protocol": "vless",
  "port": 41443,
  "transport": "reality",
  "realityPrivateKey": "...",
  "realityShortId": "...",
  "realityDest": "www.microsoft.com:443",
  "realityServerNames": ["www.microsoft.com"],
  "routes": [...]
}
```

**WS+TLS 模式（新增）：**

```json
{
  "enabled": true,
  "protocol": "vless",
  "port": 41443,
  "transport": "ws-tls",
  "wsPath": "/a3f8b2c1",
  "tlsDomain": "vpn.example.com",
  "tlsCert": "-----BEGIN CERTIFICATE-----\n...",
  "tlsKey": "-----BEGIN PRIVATE KEY-----\n...",
  "routes": [...]
}
```

当 `tlsCert` 为空时，表示 Agent 需要自动申请证书。

### 设备客户端配置生成

`GET /api/devices/{id}/config` 根据入口节点的 `xrayTransport` 生成对应的客户端配置。

**REALITY 客户端（不变）：**

```
vless://uuid@IP:port?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=...&sid=...&type=tcp#device-name
```

Xray JSON 配置中 streamSettings：
```json
{
  "network": "tcp",
  "security": "reality",
  "realitySettings": { "serverName": "...", "fingerprint": "chrome", "publicKey": "...", "shortId": "..." }
}
```

**WS+TLS 客户端（新增）：**

```
vless://uuid@域名:port?encryption=none&security=tls&type=ws&host=域名&path=/a3f8b2c1&sni=域名#device-name
```

关键差异：
- Endpoint 使用**域名**（非 IP），因为 TLS 证书需要域名验证
- `security` 从 `reality` 改为 `tls`
- `type` 从 `tcp` 改为 `ws`
- 新增 `path` 和 `host` 参数
- 去掉 `flow`、`pbk`、`sid`、`fp` 参数（这些是 REALITY 专用）

Xray JSON 配置中 streamSettings：
```json
{
  "network": "ws",
  "security": "tls",
  "wsSettings": { "path": "/a3f8b2c1", "headers": { "Host": "vpn.example.com" } },
  "tlsSettings": { "serverName": "vpn.example.com" }
}
```

## Agent 层

### Xray 配置构建（`agent/xray/config.go`）

当前硬编码 `network: "tcp"` + `security: "reality"`。改为根据 `transport` 字段动态构建 `streamSettings`：

**REALITY（不变）：**
```json
{
  "network": "tcp",
  "security": "reality",
  "realitySettings": {
    "dest": "www.microsoft.com:443",
    "serverNames": ["www.microsoft.com"],
    "privateKey": "...",
    "shortIds": ["..."]
  }
}
```

**WS+TLS（新增）：**
```json
{
  "network": "ws",
  "security": "tls",
  "wsSettings": {
    "path": "/a3f8b2c1"
  },
  "tlsSettings": {
    "certificates": [{
      "certificateFile": "/etc/wiremesh/xray/vpn.example.com.crt",
      "keyFile": "/etc/wiremesh/xray/vpn.example.com.key"
    }],
    "serverName": "vpn.example.com"
  }
}
```

### 证书文件管理（`agent/xray/manager.go`）

WS+TLS 模式时，Agent 在应用 Xray 配置前将平台下发的证书写入本地文件：

- 证书：`/etc/wiremesh/xray/{domain}.crt`
- 私钥：`/etc/wiremesh/xray/{domain}.key`（文件权限 600）

每次配置同步时对比文件内容 SHA256，有变化才重写文件并重启 Xray。

### 自动证书申请（`agent/xray/acme.go`，新增）

当平台下发的配置满足以下条件时触发自动申请：
- `transport` = `"ws-tls"`
- `tlsDomain` 非空
- `tlsCert` 为空

**申请流程：**

1. 检查本地是否已有该域名的有效证书（`/etc/wiremesh/xray/{domain}.crt`），未过期则直接使用
2. 临时监听 80 端口，执行 ACME HTTP-01 验证
3. 如果 80 端口被占用，记录错误并上报平台（`POST /api/agent/status` 的 errorMessage 字段）
4. 申请成功后，证书写入本地文件
5. 调用 `POST /api/agent/cert` 将证书内容回传给平台，平台存入 `xrayTlsCert` 和 `xrayTlsKey`
6. 后续配置同步时平台直接下发证书内容，Agent 不再重复申请

**证书续期：**

- Agent 每次配置同步时检查本地证书到期时间
- 到期前 30 天自动续期，流程同首次申请
- 续期成功后同样回传给平台更新存储

**ACME 实现：**

使用 Go 标准库 `golang.org/x/crypto/acme` + `golang.org/x/crypto/acme/autocert`，不依赖外部工具（acme.sh / certbot）。

### 新增 API：证书回传

**`POST /api/agent/cert`**

Agent 自动申请证书成功后回传给平台存储。

请求体：
```json
{
  "domain": "vpn.example.com",
  "cert": "-----BEGIN CERTIFICATE-----\n...",
  "key": "-----BEGIN PRIVATE KEY-----\n..."
}
```

鉴权：使用现有 Agent Token（X-Node-ID + X-Agent-Token）。平台收到后将 cert 存入 `xrayTlsCert`，key 加密后存入 `xrayTlsKey`，并更新 `nodes.updatedAt`。

## 节点 UI 交互

### 节点设置页面

在现有 Xray 设置区域（Reality 配置下方或替换）增加传输方式选择：

1. **传输方式**下拉框：`REALITY`（默认）/ `WebSocket + TLS`
2. 选择 **REALITY** 时：显示现有的 Reality 配置字段（dest、serverName 等），隐藏 TLS 字段
3. 选择 **WebSocket + TLS** 时：
   - 显示域名输入框（必填）
   - 显示证书管理方式：「自动申请」/「手动上传」
   - 自动申请：仅需填域名，显示提示「域名必须已解析到当前服务器，且 80 端口可被外部访问」
   - 手动上传：显示证书和私钥的文本域（textarea），粘贴 PEM 内容
   - WebSocket Path 为只读显示（自动生成，不可编辑）

### 验证规则

- 选择 WS+TLS 时，域名为必填
- 手动上传时，证书和私钥均为必填
- 自动申请时，证书字段可为空（Agent 会自动填充）

## 不涉及的变更

- WireGuard 隧道层不受影响（Xray 仅是入口层）
- SOCKS5 协议不受影响（SOCKS5 不经过 Xray）
- 线路、分支、分流规则不受影响
- Agent 安装脚本不需要变更（Xray 二进制不变，配置由 Agent 动态生成）

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/db/schema.ts` | nodes 表加 4 个字段 |
| `src/app/api/nodes/[id]/route.ts` | 节点创建/更新时处理新字段，生成 wsPath |
| `src/app/api/agent/config/route.ts` | xrayConfig 根据 transport 动态生成 |
| `src/app/api/devices/[id]/config/route.ts` | 客户端配置根据 transport 生成 WS+TLS 格式 |
| `src/app/api/agent/cert/route.ts` | **新增**，Agent 证书回传 API |
| `agent/api/config_types.go` | XrayConfig 结构体加 transport、ws、tls 字段 |
| `agent/xray/config.go` | streamSettings 动态构建 |
| `agent/xray/manager.go` | 证书文件写入逻辑 |
| `agent/xray/acme.go` | **新增**，ACME 自动申请证书 |
| `messages/zh-CN.json` | 新增 WS+TLS 相关翻译 |
| `messages/en.json` | 同上 |
| 节点设置页面组件 | 传输方式选择 UI |
