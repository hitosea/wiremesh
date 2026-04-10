# SOCKS5 代理接入设计

## 概述

SOCKS5 作为与 Xray 并列的第三种接入协议（WireGuard / Xray / SOCKS5），为设备提供基于用户名密码认证的 SOCKS5 代理接入。流量进入后走同样的隧道链路和分流规则。

## 流量路径

```
客户端 → SOCKS5 (入口节点:port) → fwmark 策略路由 → wm-tun* 隧道 → 出口节点 → 公网
单节点线路：客户端 → SOCKS5 → fwmark → eth0 直出
```

## 数据库变更

### devices 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `socks5_username` | text | 自动生成，8位随机字符串 |
| `socks5_password` | text | 自动生成，AES-256-GCM 加密存储 |

`protocol` 字段新增可选值 `"socks5"`（现有值：`"wireguard"`, `"xray"`）。

### nodes 表

不加新字段。现有 `xray_port` 字段语义扩展为「代理起始端口」，Xray 和 SOCKS5 共用同一端口池。

## 端口分配

改造 `getXrayPortForLine()` 为统一端口分配函数，按 (线路, 协议) 对分配端口：

```
从 xrayPort（默认 41443）开始，遍历入口线路（按 lineId 升序）：
  该线路有 Xray 设备 → 分配一个端口
  该线路有 SOCKS5 设备 → 分配一个端口
```

同一线路如果同时有 Xray 和 SOCKS5 设备，各分配一个端口。函数签名改为：

```typescript
function getProxyPortForLine(
  nodeId: number,
  lineId: number,
  protocol: "xray" | "socks5",
  basePort: number
): number
```

## Agent 配置 API

`GET /api/agent/config` 响应新增 `socks5` 字段，与 `xray` 并列：

```json
{
  "socks5": {
    "routes": [
      {
        "lineId": 1,
        "port": 41444,
        "mark": 32001,
        "tunnel": "wm-tun1",
        "users": [
          { "username": "abc12345", "password": "decrypted-password" }
        ]
      }
    ]
  }
}
```

- `mark`：fwmark 值，用于策略路由。使用新的 mark 范围 SOCKS5_MARK_START (32001)。
- `tunnel`：出口隧道接口名（单节点线路为节点的 externalInterface）。
- `users`：该线路所有 SOCKS5 设备的认证信息，密码为明文（从 AES 解密后下发）。

## Agent Go 实现

### 架构

在 Agent 进程内运行 SOCKS5 server（`github.com/armon/go-socks5`），不使用独立进程或 systemd 服务。

### 新增包：`agent/socks5/`

- `manager.go`：管理 SOCKS5 server 生命周期
  - `Sync(cfg *api.Socks5Config)`：对比配置，启动/停止/重启 server
  - 每条线路一个 goroutine + `net.Listener`
  - 配置变更时优雅关闭旧 listener，启动新的
- `auth.go`：实现 `socks5.CredentialStore` 接口，校验用户名密码
- 出站连接通过 `syscall.SetsockoptInt(fd, SOL_SOCKET, SO_MARK, mark)` 设置 fwmark

### Agent 类型定义

`agent/api/config_types.go` 新增：

```go
type Socks5Config struct {
    Routes []Socks5Route `json:"routes"`
}

type Socks5Route struct {
    LineID int           `json:"lineId"`
    Port   int           `json:"port"`
    Mark   int           `json:"mark"`
    Tunnel string        `json:"tunnel"`
    Users  []Socks5User  `json:"users"`
}

type Socks5User struct {
    Username string `json:"username"`
    Password string `json:"password"`
}
```

### Agent 主流程

`agent/agent/agent.go` 中 `applyConfig()` 新增 SOCKS5 同步步骤（在 Xray 之后）：

```go
// 7. Sync SOCKS5
if err := a.socks5Manager.Sync(cfgData.Socks5); err != nil {
    log.Printf("[agent] socks5 sync error: %v", err)
}
```

## 前端变更

### 设备创建页 (`/devices/new`)

- `protocol` 下拉增加 "SOCKS5" 选项
- 选择 SOCKS5 时不需要额外输入（用户名密码由后端自动生成）

### 设备配置页 (`/devices/[id]/config`)

SOCKS5 设备显示连接信息：
- 代理地址：`socks5://username:password@host:port`
- 分别显示：服务器地址、端口、用户名、密码
- 支持一键复制

### 节点创建/编辑页

- `xrayPort` 字段标签改为「代理起始端口」/ "Proxy Base Port"
- 提示文案更新为说明该端口同时用于 Xray 和 SOCKS5

## 路由常量

`src/lib/routing-constants.ts` 新增：

```typescript
export const SOCKS5_MARK_START = 32001;
export const SOCKS5_MARK_END = 32999;
```

## SOCKS5 路由集成

SOCKS5 的 fwmark 路由需要在 Agent 中配置：
- 在 `agent/wg/routing.go` 的 `SyncXrayRouting` 旁新增 `SyncSocks5Routing`
- 逻辑与 Xray 路由相同：`ip route replace default dev <tunnel> table <mark>` + `ip rule add fwmark <mark> lookup <mark>`
- iptables nat 规则：`-A POSTROUTING -o wm-tun+ -m mark --mark <socks5_mark> -j MASQUERADE`（SOCKS5 流量源 IP 是节点 IP，需要 NAT 转换为隧道 IP）

## 不受影响的部分

- WireGuard 隧道、接口、密钥管理
- Xray 现有全部功能
- 分流规则（多分支路由）— SOCKS5 通过 fwmark 自动走正确隧道
- 设备接入接口 wm-wg0 — SOCKS5 不经过 WireGuard 设备接口
