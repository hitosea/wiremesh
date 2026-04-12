# WireMesh 管理平台 — 需求文档

> 版本: 3.0
> 日期: 2026-04-12

---

## 1. 项目概述

### 1.1 定位

内部自用的 WireMesh 网络管理平台，用于管理 VPN 节点（服务器）、客户端接入点（设备）、网络线路和流量分流规则。系统由单一管理员使用，不涉及多租户和计费功能。

### 1.2 业务规模

初期中小型规模：节点 10~50 台，设备 50~200 台。

### 1.3 技术栈

| 层级 | 技术选型 |
|------|---------|
| 全栈框架 | Next.js (App Router) |
| 前端 UI | React 19 + TypeScript + shadcn/ui + Tailwind CSS |
| 数据库 | SQLite (Drizzle ORM) |
| 后台任务 | 轻量 Node.js Worker 进程（与 Next.js 同容器） |
| 节点 Agent | Go 单二进制（部署到每个节点服务器，支持 linux/amd64 和 linux/arm64） |
| VPN 协议 | WireGuard + Xray (VLESS Reality) + SOCKS5 |
| 敏感数据加密 | AES-256-GCM，密钥通过环境变量 `ENCRYPTION_KEY` 注入 |
| 国际化 | next-intl 无路由模式（中文 + 英文） |
| 部署方式 | Docker Compose（单容器） |

### 1.4 代码组织

Monorepo 结构，Agent 与管理平台在同一仓库：

```
wiremesh/
├── src/                    # Next.js 管理平台
├── agent/                  # Go Agent 源码
├── worker/                 # Node.js Worker 进程
├── docs/                   # 文档
├── messages/               # 国际化翻译文件（zh-CN.json, en.json）
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### 1.5 单容器架构

```
┌────────────────────────────────┐
│     Docker Container (管理平台)  │
│                                │
│  Next.js (Web+API+SSE)        │
│  Worker (定时任务+状态检测)      │
│  SQLite                        │
└───────────────┬────────────────┘
                │ SSE + HTTP
                ▼
          Node Agent(s)
          (Go 二进制)
```

- Next.js 同时负责前端页面渲染、API 接口和 SSE 推送
- Worker 进程负责定时任务（节点状态检测、数据清理等）
- SQLite 数据文件通过 Docker Volume 持久化
- Node Agent 运行在各节点服务器上，通过 SSE 接收通知，HTTP POST 上报数据

---

## 2. 用户与认证

### 2.1 角色

仅 **管理员** 一种角色，无多用户体系。

### 2.2 认证方式

- 用户名 + 密码登录
- JWT Token 会话管理
- 首次启动时进入初始化页面，设置管理员账号密码
- 支持修改密码

### 2.3 首次初始化

系统首次启动时（数据库无管理员记录），自动跳转到 `/setup` 页面：

- 设置管理员用户名和密码
- 其他配置使用默认值，后续可在设置页修改
- 初始化完成后跳转到登录页

---

## 3. 功能模块

### 3.1 Dashboard（仪表盘）

概览页面，展示系统整体状态：

- 节点总数 / 在线数 / 离线数
- 设备（接入点）总数 / 在线数
- 线路总数 / 活跃数
- 各节点基本流量统计（上行/下行）
- 节点/设备在线状态列表（快速预览）

---

### 3.2 节点管理 (Nodes)

节点 = 云端服务器，运行 WireGuard 和/或 Xray/SOCKS5 服务。任何节点都可以在不同线路中担任入口、中转或出口角色，角色由线路编排决定。每个节点上运行一个 Agent 进程。

**设备接入方式：**

- **WireGuard 接入**：设备通过 WireGuard 协议直接连接节点的 wm-wg0 接口
- **Xray 接入**：设备通过 VLESS Reality 协议连接节点的 Xray 服务，Xray 解密后转发到本地 wm-wg0 接口
- **SOCKS5 接入**：设备通过系统代理连接节点的 SOCKS5 服务器（用户名密码认证），流量通过 fwmark 路由到隧道

```
WireGuard 设备 ──WG 隧道──► wm-wg0(入口节点) ──► wg 隧道链 ──► 出口 ──► 互联网
Xray 设备 ──VLESS Reality──► Xray(入口节点) ──► wm-wg0 ──► wg 隧道链 ──► 出口 ──► 互联网
SOCKS5 设备 ──代理──► SOCKS5(入口节点) ──fwmark──► wg 隧道链 ──► 出口 ──► 互联网
```

**Xray 的定位：** Xray 仅作为入口层的接入代理，解决"设备怎么接入"的问题（适用于 WireGuard 被封锁的网络环境）。节点之间的隧道链路全部使用 WireGuard，不涉及 Xray。

#### 3.2.1 节点信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| name | string | 节点名称 |
| ip | string | 服务器公网 IP |
| domain | string? | 可选域名 |
| port | number | WireGuard 监听端口 |
| agent_token | string | Agent 认证 Token（创建时自动生成，唯一） |
| wg_private_key | string | WireGuard 私钥（自动生成，加密存储） |
| wg_public_key | string | WireGuard 公钥（自动生成） |
| wg_address | string | WireGuard 内网地址（如 10.210.0.1/24） |
| xray_protocol | string? | VLESS 协议 |
| xray_transport | string? | 传输层（实际使用 tcp + Reality） |
| xray_port | number? | Xray 监听端口 |
| xray_config | json? | Xray 扩展配置（含 Reality 密钥对、dest、shortId 等） |
| external_interface | string | 外网网卡名称（默认 eth0） |
| status | enum | online / offline / installing / error |
| error_message | string? | 错误信息（status 为 error 时） |
| agent_version | string? | Agent 当前版本 |
| xray_version | string? | Xray 当前版本 |
| upgrade_triggered_at | datetime? | Agent 升级触发时间 |
| xray_upgrade_triggered_at | datetime? | Xray 升级触发时间 |
| pending_delete | boolean | 是否等待卸载删除 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.2.2 节点功能

- **CRUD**：新增、编辑、删除节点
- **一键安装脚本生成**：根据节点配置生成 bash 安装脚本，支持 Ubuntu/Debian/CentOS/RHEL/Rocky/AlmaLinux/Fedora，x86_64 和 ARM64
- **远程卸载**：通过 SSE 通知 Agent 执行卸载，节点标记为 pending_delete，Worker 7 天后清理
- **Agent 升级**：通过 SSE 触发 Agent 自动下载新版本并重启
- **Xray 升级**：通过 SSE 触发 Xray 二进制更新
- **批量操作**：批量删除、批量升级
- **状态监控**：Agent 定时上报在线状态、延迟、版本号
- **配置同步**：当节点参数或关联的 Peer 变更时，通过 SSE 通知 Agent 拉取最新配置并应用

#### 3.2.3 节点状态记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| node_id | FK | 关联节点 |
| is_online | boolean | 是否在线 |
| latency | number? | 延迟（ms） |
| upload_bytes | bigint | 上行流量 |
| download_bytes | bigint | 下行流量 |
| checked_at | datetime | 检测时间 |

**数据保留策略：** 保留 7 天，Worker 定时清理过期记录。

---

### 3.3 设备管理 (Devices)

设备 = 客户端接入点，即连接到 VPN 网络的终端（电脑、手机、路由器等）。

#### 3.3.1 设备信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| name | string | 设备名称 |
| protocol | enum | 接入协议：wireguard / xray / socks5 |
| wg_public_key | string? | WireGuard 公钥（WG 协议时） |
| wg_private_key | string? | WireGuard 私钥（自动生成，加密存储，WG 协议时） |
| wg_address | string? | 分配的 WireGuard 内网 IP |
| xray_uuid | string? | Xray 客户端 UUID（Xray 协议时） |
| xray_config | json? | Xray 客户端配置参数 |
| socks5_username | string? | SOCKS5 用户名（SOCKS5 协议时，自动生成） |
| socks5_password | string? | SOCKS5 密码（SOCKS5 协议时，自动生成，加密存储） |
| line_id | FK? | 关联的线路 |
| status | enum | online / offline |
| last_handshake | datetime? | 最后握手/连接时间 |
| upload_bytes | bigint | 累计上行流量 |
| download_bytes | bigint | 累计下行流量 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.3.2 设备功能

- **CRUD**：新增、编辑、删除设备
- **自动生成密钥/UUID/账号**：创建设备时根据协议自动生成 WireGuard 密钥对、Xray UUID 或 SOCKS5 用户名密码
- **生成客户端配置**：WireGuard .conf 文件、Xray VLESS 分享链接、SOCKS5 代理地址
- **Peer 自动同步**：创建/删除/修改设备后，通过 SSE 通知相关节点 Agent 更新配置
- **关联线路**：将设备绑定到指定线路
- **流量统计**：Agent 增量上报每个设备的上行/下行流量
- **在线状态**：通过 Agent 上报的 WireGuard handshake 或 Xray 在线用户判断
- **批量操作**：批量删除、批量切换线路

---

### 3.4 线路管理 (Lines)

线路 = 逻辑隧道链路，由入口节点和出口节点组成，定义流量的转发路径。

#### 3.4.1 线路信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| name | string | 线路名称 |
| status | enum | active / inactive |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.4.2 线路节点关联（多跳支持）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK | 关联线路 |
| node_id | FK | 关联节点 |
| branch_id | FK? | 关联分支（NULL 表示主路径） |
| hop_order | number | 跳数顺序（0=入口, 1=中转, 2=出口...） |
| role | enum | entry / relay / exit |

#### 3.4.3 线路分支（line_branches）

线路支持多分支出口，用于分流规则匹配不同目标走不同路径。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK | 关联线路 |
| name | string | 分支名称 |
| is_default | boolean | 是否为默认分支 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.4.4 线路隧道（line_tunnels）

每条隧道代表两个相邻节点之间的一条 WireGuard 点对点链路。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK | 关联线路 |
| hop_index | number | 隧道序号 |
| from_node_id | FK | 低 hop_order 端节点 |
| to_node_id | FK | 高 hop_order 端节点 |
| from_wg_private_key | string | from 端 WireGuard 私钥（加密存储） |
| from_wg_public_key | string | from 端 WireGuard 公钥 |
| from_wg_address | string | from 端隧道内网 IP（如 10.211.0.1/30） |
| from_wg_port | number | from 端 WireGuard 监听端口 |
| to_wg_private_key | string | to 端 WireGuard 私钥（加密存储） |
| to_wg_public_key | string | to 端 WireGuard 公钥 |
| to_wg_address | string | to 端隧道内网 IP（如 10.211.0.2/30） |
| to_wg_port | number | to 端 WireGuard 监听端口 |
| branch_id | FK? | 关联分支（NULL 表示主路径） |

**节点自由组合规则：**

- 节点本身不限定角色，角色完全由线路编排决定
- 同一个节点可以同时参与多条线路，且在不同线路中担任不同角色
- 线路之间互相独立，互不影响

**多跳转发机制：** 每一跳建立独立的 WireGuard 隧道接口（wm-tun1, wm-tun2, ...），中转节点通过 iptables 规则转发流量。wm-wg0 保留给设备接入使用。

#### 3.4.5 线路功能

- **CRUD**：新增、编辑、删除线路
- **节点编排**：选择入口 → (可选)中转 → 出口节点
- **分支管理**：为线路创建多条分支路径，绑定不同的分流规则
- **线路状态**：根据组成节点的在线状态自动判断（Worker 定时同步）
- **配置联动**：线路变更时通知所有相关节点 Agent 更新隧道配置

---

### 3.5 分流规则 (Filters)

分流规则 = IP/CIDR 和域名路由策略，决定哪些目标流量走 VPN 线路，哪些直连。

#### 3.5.1 分流规则信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| name | string | 规则名称 |
| rules | text | IP/CIDR 规则，每行一条 |
| domain_rules | text? | 域名规则，每行一条 |
| mode | enum | whitelist（匹配走代理）/ blacklist（匹配直连） |
| is_enabled | boolean | 是否启用 |
| source_url | string? | 外部规则源 URL（定时同步） |
| source_updated_at | datetime? | 规则源最后同步时间 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.5.2 分流规则与分支关联（branch_filters）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| branch_id | FK | 关联线路分支 |
| filter_id | FK | 关联分流规则 |

#### 3.5.3 分流规则功能

- **CRUD**：新增、编辑、删除规则
- **规则编辑器**：支持 IP/CIDR 规则和域名规则
- **模式切换**：白名单 / 黑名单模式
- **外部规则源**：支持从 URL 定时同步规则
- **关联分支**：将规则绑定到线路分支
- **启用/禁用**：快速开关规则

---

### 3.6 系统设置 (Settings)

系统设置以 key-value 形式存储在 settings 表中。

#### 3.6.1 默认配置项

| key | 默认值 | 说明 |
|-----|--------|------|
| `wg_default_port` | `41820` | WireGuard 默认监听端口 |
| `wg_default_subnet` | `10.210.0.0/24` | WireGuard 默认内网网段 |
| `wg_default_dns` | `1.1.1.1` | WireGuard 客户端默认 DNS |
| `wg_node_ip_start` | `1` | 节点 IP 自动分配起始位（如 10.210.0.1） |
| `wg_device_ip_start` | `100` | 设备 IP 自动分配起始位（如 10.210.0.100） |
| `xray_default_protocol` | `vless` | Xray 默认协议 |
| `xray_default_port` | `41443` | Xray / SOCKS5 默认起始端口 |
| `tunnel_subnet` | `10.211.0.0/16` | 隧道 IP 地址池网段 |
| `tunnel_port_start` | `41830` | 隧道 WireGuard 端口自动分配起始值 |
| `node_check_interval` | `5` | 节点状态检测间隔（分钟） |
| `filter_sync_interval` | `3600` | 外部规则源同步间隔（秒，最小 60） |
| `dns_upstream` | — | DNS 上游服务器（逗号分隔） |

选用 10.210/10.211 网段和 41xxx 端口以避免与 Docker、Kubernetes、云厂商 VPC 等常见软件冲突。

---

### 3.7 操作日志 (Audit Log)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| action | string | 操作类型（create / update / delete） |
| target_type | string | 操作对象类型（node / device / line / filter / settings） |
| target_id | number? | 操作对象 ID |
| target_name | string? | 操作对象名称 |
| detail | text? | 操作详情 |
| created_at | datetime | 操作时间 |

---

## 4. Node Agent（节点 Agent）

### 4.1 技术方案

| 项目 | 方案 |
|------|------|
| 语言 | Go |
| 产物 | 单二进制文件，支持 linux/amd64 和 linux/arm64 |
| 部署 | 通过安装脚本从管理平台下载 tar.gz 并解压，注册为 systemd 服务 |
| 通信 | SSE 接收服务端通知 + HTTP GET/POST 拉取配置和上报数据 |
| 认证 | 节点级 Token（创建节点时自动生成，写入 Agent 配置） |

### 4.2 Agent 配置文件

`/etc/wiremesh/agent.yaml`：

```yaml
server_url: "https://管理平台地址"
node_id: 1
token: "节点级认证Token"
report_interval: 30   # 状态上报间隔（秒）
```

### 4.3 Agent 启动流程

```
Agent 启动
  ├── 上报安装完成（POST /api/agent/installed）
  ├── 拉取配置（GET /api/agent/config）→ 应用配置
  ├── 连接 SSE（GET /api/agent/sse）→ 接收事件
  └── 启动定时上报（每 report_interval 秒）
```

### 4.4 配置应用顺序

Agent 每次拉取到新配置后，按以下顺序应用：

1. 同步 wm-wg0 Peer 列表（wg syncconf 热加载）
2. 同步隧道 WireGuard 接口（新增/更新/销毁 wm-tun*）
3. 同步 iptables 转发规则
4. 同步 per-device 策略路由
5. 同步 Xray 配置（Reality inbound + fwmark 路由）
6. 同步 SOCKS5 服务器（per-line 启停 + fwmark 路由）
7. 同步分支路由（DNS + ipset 规则）

### 4.5 SSE 事件类型

| 事件 | 说明 |
|------|------|
| `connected` | SSE 连接建立，Agent 强制拉取最新配置 |
| `peer_update` | Peer 列表变更（设备增删改、设备切换线路） |
| `config_update` | 节点自身配置变更（参数修改、分流规则同步等） |
| `tunnel_update` | 线路隧道配置变更（多跳编排变动） |
| `upgrade` | 触发 Agent 自动升级 |
| `xray_upgrade` | 触发 Xray 二进制升级 |
| `node_delete` | 节点被删除，Agent 执行卸载 |

### 4.6 Agent 关闭流程

Agent 关闭时按逆序清理：停止 SSE、停止 Xray、停止 SOCKS5、销毁所有隧道接口、清理路由和 iptables 规则。

---

## 5. API 设计

### 5.1 认证

```
POST   /api/auth/login          # 登录，返回 JWT
POST   /api/auth/logout         # 退出
GET    /api/auth/me             # 获取当前用户信息
PUT    /api/auth/password       # 修改密码
```

### 5.2 初始化

```
GET    /api/setup/status        # 检查是否已初始化
POST   /api/setup               # 执行初始化（设置管理员账号、默认配置）
```

### 5.3 节点

```
GET    /api/nodes               # 节点列表（分页、筛选、搜索）
POST   /api/nodes               # 创建节点
GET    /api/nodes/:id           # 节点详情
PUT    /api/nodes/:id           # 更新节点
DELETE /api/nodes/:id           # 删除节点（标记 pending_delete，SSE 通知卸载）
POST   /api/nodes/batch         # 批量删除
POST   /api/nodes/batch-upgrade # 批量升级
GET    /api/nodes/:id/script    # 获取安装脚本
GET    /api/nodes/:id/uninstall-script  # 获取卸载脚本
GET    /api/nodes/:id/status    # 获取节点状态历史
POST   /api/nodes/:id/check     # 手动触发状态检测
POST   /api/nodes/:id/upgrade   # 触发 Agent 升级
POST   /api/nodes/:id/xray-upgrade  # 触发 Xray 升级
```

### 5.4 设备

```
GET    /api/devices              # 设备列表（分页、筛选、搜索）
POST   /api/devices              # 创建设备
GET    /api/devices/:id          # 设备详情
PUT    /api/devices/:id          # 更新设备
DELETE /api/devices/:id          # 删除设备
POST   /api/devices/batch        # 批量删除
GET    /api/devices/:id/config   # 获取客户端配置
PUT    /api/devices/:id/line     # 切换关联线路
```

### 5.5 线路

```
GET    /api/lines                # 线路列表（分页、筛选、搜索）
POST   /api/lines                # 创建线路
GET    /api/lines/:id            # 线路详情（含节点编排和分支）
PUT    /api/lines/:id            # 更新线路
DELETE /api/lines/:id            # 删除线路
GET    /api/lines/:id/devices    # 查看关联设备
```

### 5.6 分流规则

```
GET    /api/filters              # 规则列表（分页、筛选、搜索）
POST   /api/filters              # 创建规则
GET    /api/filters/:id          # 规则详情
PUT    /api/filters/:id          # 更新规则
DELETE /api/filters/:id          # 删除规则
PUT    /api/filters/:id/toggle   # 启用/禁用
POST   /api/filters/:id/sync    # 手动同步外部规则源
```

### 5.7 系统

```
GET    /api/settings             # 获取系统设置
PUT    /api/settings             # 更新系统设置
GET    /api/dashboard            # Dashboard 统计数据
GET    /api/audit-logs           # 操作日志列表（分页、筛选）
```

### 5.8 Agent API（Token 认证）

```
GET    /api/agent/sse            # SSE 长连接，推送配置变更通知
GET    /api/agent/config         # 获取节点完整配置
POST   /api/agent/status         # 上报节点状态
POST   /api/agent/error          # 上报错误信息
POST   /api/agent/installed      # 上报安装完成
GET    /api/agent/binary         # 下载 Agent 二进制（tar.gz，支持 ?arch=amd64|arm64）
GET    /api/agent/xray           # 下载 Xray 二进制（tar.gz，支持 ?arch=amd64|arm64）
```

### 5.9 Admin SSE

```
GET    /api/admin/sse            # 管理后台实时推送（节点状态、设备状态变更）
```

### 5.10 API 统一响应格式

**成功响应：**

```json
{ "data": { ... } }
```

**列表响应：**

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

**错误响应：**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "validation.nameRequired"
  }
}
```

错误消息使用翻译 key，前端负责翻译显示。

**HTTP 状态码 / 错误码：**

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | 请求参数校验失败 |
| 401 | UNAUTHORIZED | 未登录或 Token 过期 |
| 403 | FORBIDDEN | 无权限访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突（IP/名称重复等） |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
| 502 | CONFIG_SYNC_FAILED | 配置同步失败 |
| 503 | NODE_OFFLINE | 节点不在线 |

### 5.11 分页约定

所有列表 API 支持统一的分页参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| page | 页码 | 1 |
| pageSize | 每页条数 | 20 |
| search | 搜索关键词 | — |
| status | 状态筛选 | — |
| sortBy | 排序字段 | created_at |
| sortOrder | 排序方向 asc/desc | desc |

---

## 6. 数据库设计

### 6.1 ER 关系图

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│  nodes   │◄──────│ line_nodes   │──────►│  lines   │
│          │  1:N  │              │  N:1  │          │
└──────────┘       └──────────────┘       └────┬─────┘
     │                                         │
     │ 1:N                                1:N  │
     ▼                                         ▼
┌──────────────┐                     ┌──────────────┐
│ node_status  │                     │   devices    │
└──────────────┘                     └──────────────┘

┌──────────┐       ┌──────────────┐       ┌──────────────┐
│  lines   │──────►│ line_branches│──────►│branch_filters│
│          │  1:N  │              │  1:N  │              │
└──────────┘       └──────────────┘       └──────┬───────┘
                                                 │ N:1
┌──────────┐       ┌──────────────┐              │
│  lines   │──────►│ line_tunnels │       ┌──────┴───────┐
│          │  1:N  │              │       │   filters    │
└──────────┘       └──────────────┘       └──────────────┘

┌──────────┐       ┌──────────────┐
│  users   │       │  settings    │
└──────────┘       └──────────────┘

┌──────────────┐
│ audit_logs   │
└──────────────┘
```

### 6.2 表清单

| 表名 | 说明 |
|------|------|
| users | 管理员账号 |
| nodes | VPN 节点 |
| node_status | 节点状态监控记录（保留 7 天） |
| lines | 网络线路 |
| line_nodes | 线路-节点关联（含跳数顺序和角色） |
| line_branches | 线路分支（多出口路径） |
| line_tunnels | 线路隧道（每条隧道两端的密钥对、地址和端口） |
| devices | 客户端接入点 |
| filters | 分流规则（IP/CIDR + 域名） |
| branch_filters | 分支-分流规则关联 |
| settings | 系统设置（key-value） |
| audit_logs | 操作日志 |

### 6.3 IP 地址自动分配

#### 设备接入网段（wm-wg0）

基于 `wg_default_subnet`（默认 `10.210.0.0/24`）分配：

- **节点**：从第 `wg_node_ip_start` 位开始（默认 .1），如 10.210.0.1, 10.210.0.2, ...
- **设备**：从第 `wg_device_ip_start` 位开始（默认 .100），如 10.210.0.100, 10.210.0.101, ...

分配逻辑：查询已使用的 IP，找下一个空闲 IP，已删除的 IP 可复用。

#### 隧道网段（wm-tun*）

基于 `tunnel_subnet`（默认 `10.211.0.0/16`）分配，每条隧道分配一个 /30 子网（2 个可用 IP）。

隧道端口从 `tunnel_port_start`（默认 41830）开始递增分配。

---

## 7. 页面结构

```
/setup                          # 首次启动初始化页
/login                          # 登录页

/dashboard                      # 仪表盘（首页）

/nodes                          # 节点列表
/nodes/new                      # 新增节点
/nodes/:id                      # 节点详情/编辑
/nodes/:id/script               # 安装脚本

/devices                        # 设备列表
/devices/new                    # 新增设备
/devices/:id                    # 设备详情/编辑
/devices/:id/config             # 客户端配置

/lines                          # 线路列表
/lines/new                      # 新增线路
/lines/:id                      # 线路详情/编辑

/filters                        # 分流规则列表
/filters/new                    # 新增规则
/filters/:id                    # 规则详情/编辑

/settings                       # 系统设置
/settings/logs                  # 操作日志
/help                           # 帮助页
```

---

## 8. 后台任务（Worker）

Worker 进程与 Next.js 运行在同一容器内，启动后延迟 30 秒开始执行。

| 任务 | 频率 | 说明 |
|------|------|------|
| 节点状态检测 | 5 分钟 | 检查 Agent 最后上报时间，超过 10 分钟标记为 offline |
| 线路状态同步 | 5 分钟 | 根据节点在线状态更新线路 active/inactive |
| 监控数据清理 | 1 小时 | 清理 7 天前的 node_status 记录 |
| 待删除节点清理 | 1 小时 | 清理 pending_delete 超过 7 天的节点 |

---

## 9. 安装脚本

安装脚本由 `GET /api/nodes/:id/script` 动态生成，主要阶段：

1. **环境检测**：root 权限、架构检测（amd64/arm64）、OS 版本检测、内核版本检查（<5.6 警告）、systemd 检查、连通性检查、磁盘空间检查
2. **安装依赖**：WireGuard（wireguard + wireguard-tools）、iptables、ipset，根据 OS 使用 apt/yum/dnf
3. **下载二进制**：从管理平台下载 Agent 和 Xray 的 tar.gz（按架构），SHA256 校验，失败重试 3 次
4. **配置 WireGuard**：写入 wm-wg0.conf，启用 ip_forward，使用 `ip link` + `wg setconf` 启动接口（不使用 wg-quick）
5. **部署 Xray**：解压 Xray 二进制，注册 wiremesh-xray.service（enable 但不 start，由 Agent 管理）
6. **部署 Agent**：解压 Agent 二进制，写入 agent.yaml，注册 wiremesh-agent.service 并启动

脚本支持升级模式（检测到已有安装时跳过部分步骤）。

---

## 10. Docker 部署

### 10.1 docker-compose.yml

```yaml
services:
  wiremesh:
    image: ghcr.io/hitosea/wiremesh:latest
    build:
      context: .
      args:
        AGENT_VERSION: ${AGENT_VERSION:-dev}
    ports:
      - "3456:3000"
    volumes:
      - ./data:/app/data
    environment:
      - JWT_SECRET=${JWT_SECRET:-<内置默认值>}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-<内置默认值>}
      - PUBLIC_URL=${PUBLIC_URL:-http://localhost:3456}
      - HOSTNAME=0.0.0.0
    restart: unless-stopped
```

### 10.2 Dockerfile

四阶段构建：

1. **xray-downloader**（alpine）：从 GitHub 下载 Xray 双架构二进制，打包为 tar.gz
2. **agent-builder**（golang:1.25-alpine）：编译 Agent 双架构二进制（CGO_ENABLED=0），版本号从 package.json 读取，打包为 tar.gz
3. **builder**（node:20-alpine）：`npm install` + `npm run build` 构建 Next.js
4. **runner**（node:20-alpine）：复制 standalone 产物、静态文件、Drizzle 迁移、Worker、Agent 和 Xray 二进制包

启动命令：`node worker/index.js & node server.js`

---

## 11. 敏感数据加密

### 11.1 加密方案

AES-256-GCM 对称加密，密钥通过环境变量 `ENCRYPTION_KEY` 注入（64 位十六进制字符串 = 32 字节）。每次加密使用随机 12 字节 IV。

存储格式：`Base64( IV + AuthTag + Ciphertext )`

### 11.2 加密字段

| 表 | 字段 | 说明 |
|----|------|------|
| nodes | wg_private_key | 节点 WireGuard 私钥 |
| nodes | xray_config 内的 reality_private_key | Xray Reality 私钥 |
| devices | wg_private_key | 设备 WireGuard 私钥 |
| devices | socks5_password | SOCKS5 密码 |
| line_tunnels | from_wg_private_key | 隧道 from 端私钥 |
| line_tunnels | to_wg_private_key | 隧道 to 端私钥 |

---

## 12. 非功能性需求

| 项目 | 要求 |
|------|------|
| 响应式 | 适配桌面和平板，不需要移动端优化 |
| 安全 | 敏感数据 AES-256-GCM 加密存储；管理 API 全部需要 JWT 认证；Agent API 使用节点级 Token 认证 |
| 性能 | SQLite 足以支撑单管理员使用场景；服务端分页避免大量数据传输 |
| 日志 | 关键操作日志记录到 audit_logs 表 |
| 国际化 | 中文 + 英文，使用 next-intl 无路由模式 |
| 错误处理 | 配置同步/安装失败时记录错误信息，Dashboard 高亮提示 |
