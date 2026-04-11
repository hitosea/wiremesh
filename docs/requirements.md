# WireMesh 管理平台 — 需求文档

> 版本: 2.4  
> 日期: 2026-04-06

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
| 前端 UI | React 18 + TypeScript + shadcn/ui + Tailwind CSS |
| 数据库 | SQLite (via better-sqlite3 或 Drizzle ORM) |
| 后台任务 | 轻量 Node.js Worker 进程（与 Next.js 同容器） |
| 节点 Agent | Go 单二进制（部署到每个节点服务器） |
| VPN 协议 | WireGuard + Xray (VLESS + WebSocket/gRPC) |
| 敏感数据加密 | AES-256-GCM，密钥通过环境变量 `ENCRYPTION_KEY` 注入 |
| 部署方式 | Docker Compose（单容器） |

### 1.4 代码组织

Monorepo 结构，Agent 与管理平台在同一仓库：

```
wiremesh/
├── src/                    # Next.js 管理平台
├── agent/                  # Go Agent 源码
├── worker/                 # Node.js Worker 进程
├── docs/                   # 文档
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### 1.5 单容器架构

使用一个 Docker 容器运行所有服务：

```
┌──────────────────────────────────────┐
│           Docker Container           │
│                                      │
│  ┌───────────┐  ┌──────────────────┐ │
│  │  Next.js   │  │  Worker          │ │
│  │  (Web+API  │  │  (定时任务       │ │
│  │   +SSE)    │  │   +状态检测)     │ │
│  └─────┬─────┘  └───────┬──────────┘ │
│        │                 │            │
│        └────────┬────────┘            │
│                 │                     │
│          ┌──────┴──────┐              │
│          │   SQLite    │              │
│          │(wiremesh.db)│              │
│          └─────────────┘              │
└──────────────────────────────────────┘
         ▲
         │ SSE (通知) + HTTP POST (上报/拉取)
         ▼
┌─────────────────┐
│  Node Agent(s)  │
│  (Go 二进制)     │
│  运行在各节点上   │
└─────────────────┘
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
- 首次启动时进入初始化页面，设置管理员账号密码及 WireGuard 默认网段
- 支持修改密码

### 2.3 首次初始化

系统首次启动时（数据库无管理员记录），自动跳转到 `/setup` 页面：

- 设置管理员用户名和密码
- 设置 WireGuard 默认内网网段（如 `10.0.0.0/24`）
- 其他配置使用默认值，后续可在设置页修改
- 初始化完成后跳转到登录页

### 2.4 页面

| 页面 | 说明 |
|------|------|
| 初始化页 `/setup` | 首次启动时的管理员账号设置 |
| 登录页 `/login` | 用户名 + 密码表单 |
| 全局布局 | 侧边栏导航 + 顶部栏（用户信息、退出） |

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

节点 = 云端服务器，运行 WireGuard 和/或 Xray 服务。任何节点都可以在不同线路中担任入口、中转或出口角色，角色由线路编排决定。每个节点上运行一个 Agent 进程。

**设备接入方式：**

- **WireGuard 接入**：设备通过 WireGuard 协议直接连接节点的 wm-wg0 接口
- **Xray 接入**：设备通过 VLESS (WS/gRPC) 协议连接节点的 Xray 服务，Xray 作为入口层代理，将流量解密后转发到本地 wm-wg0 接口

两种接入方式进入 wm-wg0 后，后续链路完全相同（走 WireGuard 隧道链路转发到出口）。

```
WireGuard 设备 ──WG 隧道──► wm-wg0(入口节点) ──► wg 隧道链 ──► 出口 ──► 互联网
Xray 设备 ──VLESS──► Xray(入口节点) ──► wm-wg0 ──► wg 隧道链 ──► 出口 ──► 互联网
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
| wg_address | string | WireGuard 内网地址（如 10.0.0.1/24） |
| ~~xray_enabled~~ | ~~boolean~~ | ~~已废弃，代理服务由线路编排决定~~ |
| xray_protocol | enum? | VLESS 协议 |
| xray_transport | enum? | 传输层：ws / grpc |
| xray_port | number? | Xray 监听端口 |
| xray_config | json? | Xray 扩展配置参数 |
| status | enum | online / offline / installing / error |
| error_message | string? | 错误信息（status 为 error 时） |
| tags | string? | 标签，逗号分隔 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.2.2 节点功能

- **CRUD**：新增、编辑、删除节点
- **一键安装脚本生成**：
  - 根据节点配置生成 bash 安装脚本
  - 脚本内容包括：安装 WireGuard、配置 wm-wg0 接口、安装 Xray（如启用）、下载并安装 Agent 二进制、注册 systemd 服务、启动所有服务
  - 管理员复制脚本到节点服务器上执行
  - Agent 启动后通过 SSE 连接管理平台，上报安装完成状态
- **状态监控**：Agent 定时上报在线状态和延迟
- **配置同步**：当节点参数或关联的 Peer 变更时，通过 SSE 通知 Agent 拉取最新配置并应用
- **批量操作**：批量删除、批量更新标签
- **错误处理**：配置同步或安装失败时，节点状态标记为 error，记录错误信息，Dashboard 高亮提示

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

设备 = 客户端接入点，即连接到 VPN 网络的终端（电脑、手机、路由器等），通过 WireGuard 或 Xray 协议接入。

#### 3.3.1 设备信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| name | string | 设备名称 |
| protocol | enum | 接入协议：wireguard / xray |
| wg_public_key | string? | WireGuard 公钥（WG 协议时） |
| wg_private_key | string? | WireGuard 私钥（自动生成，加密存储，WG 协议时） |
| wg_address | string? | 分配的 WireGuard 内网 IP |
| xray_uuid | string? | Xray 客户端 UUID（Xray 协议时） |
| xray_config | json? | Xray 客户端配置参数 |
| line_id | FK? | 关联的线路 |
| status | enum | online / offline |
| last_handshake | datetime? | 最后握手/连接时间 |
| tags | string? | 标签 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.3.2 设备功能

- **CRUD**：新增、编辑、删除设备
- **自动生成密钥/UUID**：创建设备时自动生成 WireGuard 密钥对或 Xray UUID
- **生成客户端配置**：根据设备信息和关联线路，生成可直接使用的客户端配置文件（WireGuard .conf 或 Xray JSON）
- **Peer 自动同步**：创建/删除/修改设备后，通过 SSE 通知相关节点的 Agent 拉取最新 Peer 列表并更新 WireGuard 配置
- **关联线路**：将设备绑定到指定线路
- **在线状态**：通过节点 Agent 上报的 WireGuard handshake 信息判断
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
| tags | string? | 标签 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.4.2 线路节点关联（多跳支持）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK | 关联线路 |
| node_id | FK | 关联节点 |
| hop_order | number | 跳数顺序（0=入口, 1=中转, 2=出口...） |
| role | enum | entry / relay / exit |

#### 3.4.3 线路隧道（line_tunnels）

每条隧道代表两个相邻节点之间的一条 WireGuard 点对点链路，包含两端各自的密钥、地址和端口。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK | 关联线路 |
| hop_index | number | 隧道序号（0=第一跳, 1=第二跳...） |
| from_node_id | FK | 低 hop_order 端节点 |
| to_node_id | FK | 高 hop_order 端节点 |
| from_wg_private_key | string | from 端 WireGuard 私钥（自动生成，加密存储） |
| from_wg_public_key | string | from 端 WireGuard 公钥（自动生成） |
| from_wg_address | string | from 端隧道内�� IP（如 10.1.0.1/30） |
| from_wg_port | number | from 端 WireGuard 监听端口 |
| to_wg_private_key | string | to 端 WireGuard 私钥（自动生成，加密存储） |
| to_wg_public_key | string | to 端 WireGuard 公钥（自动生成） |
| to_wg_address | string | to 端隧道内网 IP（如 10.1.0.2/30） |
| to_wg_port | number | to 端 WireGuard 监听端口 |

**示例（线路 A→B→C）：**

| line_id | hop_index | from_node | to_node | from 端 | to 端 |
|---------|-----------|-----------|---------|---------|-------|
| 3 | 0 | A | B | 10.1.0.1/30 :51830 | 10.1.0.2/30 :51830 |
| 3 | 1 | B | C | 10.1.0.5/30 :51831 | 10.1.0.6/30 :51831 |

中转节点 B 出现在两行中——hop_index=0 的 to 端和 hop_index=1 的 from 端——天然拥有两套独立的隧道密钥和地址。

**说明：** `line_tunnels` 中的密钥与节点表上的 wg_private_key/wg_public_key（给设备接入 wm-wg0 用的）完全独立。创建线路编排时自动生成。

**节点自由组合规则：**

- 节点本身不限定角色，角色完全由线路编排（line_nodes）决定
- 同一个节点可以同时参与多条线路，且在不同线路中担任不同角色
- 一个节点可以同时是线路 1 的入口、线路 2 的出口、线路 3 的中转
- 线路之间互相独立，互不影响

**组合示例：**

假设有 A、B、C 三个节点，可以自由组合出以下线路：

```
线路 1: A(入口) → B(出口)           # A 当入口，B 当出口
线路 2: A(入口) → C(出口)           # A 同时也是另一条线路的入口
线路 3: A(入口) → B(中转) → C(出口)  # B 在这条线路里当中转
线路 4: C(入口) → A(出口)           # A 在这条线路里变成出口
线路 5: B(入口) → A(中转) → C(出口)  # A 在这条线路里当中转
```

上述线路可以**同时存在并同时生效**。每个节点的 Agent 会收到它参与的所有线路的隧道配置。

**多跳转发机制：** 使用 WireGuard 隧道嵌套。每一跳建立独立的 WireGuard 隧道，中转节点作为上一跳的 Peer 和下一跳的 Peer，通过 iptables 规则转发流量。

**流量路径示例（线路 3）：**

```
设备 → [A 入口 hop_order=0] ──── [B 中转 hop_order=1] ──── [C 出口 hop_order=2] → 互联网
        ╰── A↔B 隧道 (hop_index=0) ──╯╰── B↔C 隧道 (hop_index=1) ──╯
```

每条线路的隧道使用独立的 WireGuard 接口（wm-tun1, wm-tun2, wm-tun3...），wm-wg0 保留给设备接入使用。Agent 负责配置所有相关的 WireGuard 接口和 iptables 转发规则。

#### 3.4.3 线路功能

- **CRUD**：新增、编辑、删除线路
- **节点编排**：选择入口 → (可选)中转 → 出口节点，定义跳数顺序。同一节点可出现在多条线路中
- **线路状态**：根据组成节点的在线状态自动判断线路可用性
- **关联设备查看**：查看哪些设备正在使用此线路
- **节点线路查看**：在节点详情中查看该节点参与的所有线路及角色
- **配置联动**：线路节点编排变更时，通知相关节点 Agent 更新隧道配置

---

### 3.5 分流规则 (Filters)

分流规则 = IP/CIDR 路由策略，决定哪些目标流量走 VPN 加速线路，哪些直连。

#### 3.5.1 分流规则信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| name | string | 规则名称（如"国外流量"、"视频加速"） |
| rules | text | 规则内容，每行一条 IP/CIDR |
| mode | enum | whitelist（仅匹配走代理）/ blacklist（匹配的不走代理） |
| is_enabled | boolean | 是否启用 |
| tags | string? | 标签 |
| remark | text? | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### 3.5.2 分流规则与线路关联

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK | 关联线路 |
| filter_id | FK | 关联分流规则 |

#### 3.5.3 分流规则功能

- **CRUD**：新增、编辑、删除规则
- **规则编辑器**：支持批量输入 IP/CIDR，每行一条
- **模式切换**：白名单模式（仅匹配走代理）/ 黑名单模式（匹配的直连）
- **关联线路**：将规则应用到指定线路
- **启用/禁用**：快速开关规则

---

### 3.6 系统设置 (Settings)

系统设置以 key-value 形式存储在 settings 表中。

#### 3.6.1 默认配置项

| key | 默认值 | 说明 |
|-----|--------|------|
| `wg_default_port` | `51820` | WireGuard 默认监听端口 |
| `wg_default_subnet` | `10.0.0.0/24` | WireGuard 默认内网网段 |
| `wg_default_dns` | `1.1.1.1` | WireGuard 客户端默认 DNS |
| `wg_node_ip_start` | `1` | 节点 IP 自动分配起始位（如 10.0.0.1） |
| `wg_device_ip_start` | `100` | 设备 IP 自动分配起始位（如 10.0.0.100） |
| `xray_default_protocol` | `vless` | Xray 默认协议 |
| `xray_default_transport` | `ws` | Xray 默认传输层（ws / grpc） |
| `xray_default_port` | `443` | Xray 默认监听端口 |
| `tunnel_subnet` | `10.1.0.0/16` | 隧道 IP 地址池网段（节点间点对点隧道使用） |
| `tunnel_port_start` | `51830` | 隧道 WireGuard 端口自动分配起始值 |
| `node_check_interval` | `5` | 节点状态检测间隔（分钟） |

#### 3.6.2 管理功能

| 设置项 | 说明 |
|--------|------|
| 管理员密码 | 修改登录密码 |
| WireGuard 默认参数 | 默认监听端口、内网网段、DNS 等 |
| Xray 默认参数 | 默认协议类型（VLESS）、传输层（WS/gRPC）、端口等 |
| 节点检测间隔 | 定时检测节点在线状态的频率（分钟） |

---

### 3.7 操作日志 (Audit Log)

记录关键操作，用于审计回溯。

#### 3.7.1 日志信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| action | string | 操作类型（create / update / delete） |
| target_type | string | 操作对象类型（node / device / line / filter / settings） |
| target_id | number? | 操作对象 ID |
| target_name | string? | 操作对象名称 |
| detail | text? | 操作详情（如变更内容摘要） |
| created_at | datetime | 操作时间 |

#### 3.7.2 记录范围

- 节点的增删改操作
- 设备的增删改操作
- 线路的增删改操作
- 分流规则的增删改操作
- 系统设置变更
- 配置同步事件（成功/失败）

---

## 4. Node Agent（节点 Agent）

### 4.1 概述

Node Agent 是运行在每个节点服务器上的 Go 常驻进程，负责与管理平台通信、执行本地配置变更和上报状态。

### 4.2 技术方案

| 项目 | 方案 |
|------|------|
| 语言 | Go |
| 产物 | 单二进制文件，无运行时依赖 |
| 部署 | 通过安装脚本从管理平台下载，注册为 systemd 服务 |
| 通信 | SSE 接收服务端通知 + HTTP POST 上报数据和拉取配置 |
| 认证 | 节点级 Token（创建节点时自动生成，写入 Agent 配置） |

### 4.3 Agent 配置文件

Agent 启动时读取配置文件 `/etc/wiremesh/agent.yaml`：

```yaml
server_url: "https://管理平台地址:3000"
node_id: 1
token: "节点级认证Token"
report_interval: 300   # 状态上报间隔（秒），默认 5 分钟
```

### 4.4 Agent 功能

| 功能 | 说明 |
|------|------|
| SSE 连接 | 启动后连接管理平台 SSE 端点，接收配置变更通知。断线自动重连。 |
| 配置拉取 | 收到 SSE 通知后，通过 HTTP GET 拉取最新的 WireGuard/Xray 配置 |
| wm-wg0 Peer 管理 | 更新 wm-wg0.conf 中的 Peer 列表，执行 `wg syncconf wm-wg0` 热加载（无需重启） |
| 隧道接口管理 | 动态创建/更新/销毁隧道 WireGuard 接口（wm-tun1, wm-tun2, ...），见 4.4.1 |
| iptables 管理 | 维护隧道转发所需的 iptables 规则，见 4.4.2 |
| Xray 配置 | 更新 Xray 配置文件并重载服务 |
| 状态上报 | 定时通过 HTTP POST 上报：在线状态、延迟（ping 管理平台）、流量统计 |
| 流量采集 | 解析所有 wg 接口（wm-wg0, wm-tun1, ...）的 `wg show transfer` 输出，获取流量数据 |
| 错误上报 | 配置应用失败时，通过 HTTP POST 上报错误信息 |

#### 4.4.1 隧道接口生命周期管理

Agent 维护一份本地的**隧道接口状态表**（内存中），记录当前活跃的隧道接口。每次收到配置更新时，对比新配置与本地状态，执行三种操作：

**新增隧道接口（新线路或新增跳）：**

```bash
# 1. 创建 WireGuard 接口
ip link add wm-tun1 type wireguard

# 2. 写入接口配置文件
cat > /etc/wiremesh/wireguard/wm-tun1.conf << EOF
[Interface]
PrivateKey = {tunnel_wg_private_key}
ListenPort = {tunnel_wg_port}

[Peer]
PublicKey = {对端tunnel_wg_public_key}
AllowedIPs = {allowed_ips}
Endpoint = {对端公网IP}:{对端tunnel_wg_port}
PersistentKeepalive = 25
EOF

# 3. 应用配置并启动
wg setconf wm-tun1 /etc/wiremesh/wireguard/wm-tun1.conf
ip addr add {tunnel_wg_address} dev wm-tun1
ip link set wm-tun1 up

# 4. 添加 iptables 转发规则（见 4.4.2）
```

**更新隧道接口（Peer 变更）：**

```bash
# 使用 wg syncconf 热加载，无需销毁重建
wg syncconf wm-tun1 /etc/wiremesh/wireguard/wm-tun1.conf
```

**销毁隧道接口（线路删除或节点移出线路）：**

```bash
# 1. 清理 iptables 规则
iptables -D FORWARD -i wm-wg0 -o wm-tun1 -j ACCEPT
iptables -D FORWARD -i wm-tun1 -o wm-wg0 -j ACCEPT

# 2. 关闭并删除接口
ip link set wm-tun1 down
ip link del wm-tun1

# 3. 删除配置文件
rm /etc/wiremesh/wireguard/wm-tun1.conf
```

#### 4.4.2 iptables 转发规则管理

Agent 根据节点在线路中的角色，管理不同的 iptables 规则：

**入口节点（设备流量 → 下一跳）：**

```bash
# 允许 wm-wg0（设备接入）到 wm-tun1（隧道）的转发
iptables -A FORWARD -i wm-wg0 -o wm-tun1 -j ACCEPT
iptables -A FORWARD -i wm-tun1 -o wm-wg0 -j ACCEPT
```

**中转节点（上一跳 → 下一跳）：**

```bash
# 允许 wm-tun1（上游隧道）到 wm-tun2（下游隧道）的转发
iptables -A FORWARD -i wm-tun1 -o wm-tun2 -j ACCEPT
iptables -A FORWARD -i wm-tun2 -o wm-tun1 -j ACCEPT
```

**出口节点（隧道流量 → 互联网）：**

```bash
# 允许隧道流量出站并做 NAT
iptables -A FORWARD -i wm-tun1 -o eth0 -j ACCEPT
iptables -A FORWARD -i eth0 -o wm-tun1 -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -A POSTROUTING -o eth0 -s {tunnel_subnet} -j MASQUERADE
```

**规则命名约定：** Agent 使用 iptables comment 模块为每条规则打标签（如 `--comment "wm-line-3"`），便于精确清理特定线路的规则而不影响其他线路。

### 4.5 Agent API 交互

Agent 调用管理平台的 API：

```
# Agent → 管理平台
GET  /api/agent/sse               # SSE 长连接（Header: Authorization: Bearer {token}）
GET  /api/agent/config             # 拉取节点完整配置（WG peers、Xray 等）
POST /api/agent/status             # 上报节点状态（在线、延迟、流量）
POST /api/agent/error              # 上报错误信息
POST /api/agent/installed          # 上报安装完成
```

### 4.6 SSE 事件类型

| 事件 | 说明 |
|------|------|
| `peer_update` | Peer 列表变更（设备增删改、设备切换线路） |
| `config_update` | 节点自身配置变更（端口、Xray 参数等） |
| `tunnel_update` | 线路隧道配置变更（多跳编排变动） |

Agent 收到事件后，调用 `/api/agent/config` 拉取最新完整配置并应用。

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
GET    /api/nodes               # 节点列表（支持分页、筛选、搜索）
POST   /api/nodes               # 创建节点
GET    /api/nodes/:id           # 节点详情
PUT    /api/nodes/:id           # 更新节点
DELETE /api/nodes/:id           # 删除节点
GET    /api/nodes/:id/script    # 获取安装脚本
GET    /api/nodes/:id/status    # 获取节点状态历史
POST   /api/nodes/:id/check     # 手动触发状态检测
```

### 5.4 设备

```
GET    /api/devices              # 设备列表（支持分页、筛选、搜索）
POST   /api/devices              # 创建设备
GET    /api/devices/:id          # 设备详情
PUT    /api/devices/:id          # 更新设备
DELETE /api/devices/:id          # 删除设备
GET    /api/devices/:id/config   # 获取客户端配置文件
PUT    /api/devices/:id/line     # 切换关联线路
```

### 5.5 线路

```
GET    /api/lines                # 线路列表（支持分页、筛选、搜索）
POST   /api/lines                # 创建线路
GET    /api/lines/:id            # 线路详情（含节点编排）
PUT    /api/lines/:id            # 更新线路
DELETE /api/lines/:id            # 删除线路
GET    /api/lines/:id/devices    # 查看关联设备
```

### 5.6 分流规则

```
GET    /api/filters              # 规则列表（支持分页、筛选、搜索）
POST   /api/filters              # 创建规则
GET    /api/filters/:id          # 规则详情
PUT    /api/filters/:id          # 更新规则
DELETE /api/filters/:id          # 删除规则
PUT    /api/filters/:id/toggle   # 启用/禁用
```

### 5.7 系统

```
GET    /api/settings             # 获取系统设置
PUT    /api/settings             # 更新系统设置
GET    /api/dashboard            # Dashboard 统计数据
GET    /api/audit-logs           # 操作日志列表（支持分页、筛选）
```

### 5.8 Agent API（Token 认证）

供节点 Agent 调用，使用节点级 Token 认证（Bearer Token）：

```
GET    /api/agent/sse            # SSE 长连接，推送配置变更通知
GET    /api/agent/config         # 获取节点完整配置（WG peers、Xray、隧道等）
POST   /api/agent/status         # 上报节点状态
POST   /api/agent/error          # 上报错误信息
POST   /api/agent/installed      # 上报安装完成
```

### 5.9 Agent 二进制下载

```
GET    /api/agent/binary         # 下载 Agent 二进制文件（仅 linux/amd64）
```

此接口无需认证，安装脚本中使用。Agent 二进制在 Docker 构建时编译，打包在管理平台镜像中。

### 5.10 API 统一响应格式

**成功响应：**

```json
{
  "data": { ... }
}
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
    "message": "节点名称不能为空"
  }
}
```

**HTTP 状态码约定：**

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误（VALIDATION_ERROR） |
| 401 | 未认证（UNAUTHORIZED） |
| 403 | 无权限（FORBIDDEN） |
| 404 | 资源不存在（NOT_FOUND） |
| 409 | 资源冲突，如 IP 已被占用（CONFLICT） |
| 500 | 服务器内部错误（INTERNAL_ERROR） |

**错误码清单：**

| 错误码 | 说明 |
|--------|------|
| UNAUTHORIZED | 未登录或 Token 过期 |
| FORBIDDEN | 无权限访问 |
| NOT_FOUND | 资源不存在 |
| VALIDATION_ERROR | 请求参数校验失败 |
| CONFLICT | 资源冲突（IP 重复、名称重复等） |
| INTERNAL_ERROR | 服务器内部错误 |
| NODE_OFFLINE | 节点不在线，无法执行操作 |
| CONFIG_SYNC_FAILED | 配置同步失败 |

### 5.11 Dashboard API 响应结构

`GET /api/dashboard` 返回：

```json
{
  "data": {
    "nodes": {
      "total": 10,
      "online": 8,
      "offline": 1,
      "error": 1
    },
    "devices": {
      "total": 50,
      "online": 35,
      "offline": 15
    },
    "lines": {
      "total": 5,
      "active": 4,
      "inactive": 1
    },
    "traffic": [
      {
        "node_id": 1,
        "node_name": "东京节点",
        "upload_bytes": 1073741824,
        "download_bytes": 5368709120
      }
    ],
    "recent_nodes": [
      {
        "id": 1,
        "name": "东京节点",
        "ip": "1.2.3.4",
        "status": "online",
        "latency": 45
      }
    ],
    "recent_devices": [
      {
        "id": 1,
        "name": "MacBook",
        "status": "online",
        "last_handshake": "2026-04-06T10:30:00Z"
      }
    ]
  }
}
```

### 5.12 Agent Config 响应结构

`GET /api/agent/config` 返回节点的完整配置，Agent 据此生成本地配置文件：

```json
{
  "data": {
    "node": {
      "id": 1,
      "name": "东京节点",
      "ip": "1.2.3.4",
      "wg_address": "10.0.0.1/24",
      "wg_port": 51820,
      "wg_private_key": "节点WG私钥（明文，传输层HTTPS保护）"
    },
    "peers": [
      {
        "public_key": "设备或对端节点的WG公钥",
        "allowed_ips": "10.0.0.100/32",
        "endpoint": null,
        "persistent_keepalive": 25
      }
    ],
    "tunnels": [
      {
        "line_id": 3,
        "line_name": "东京-新加坡线路",
        "role": "entry",
        "interfaces": [
          {
            "name": "wm-tun1",
            "direction": "downstream",
            "private_key": "本节点在此隧道的私钥（来自 line_tunnels.from_wg_private_key）",
            "address": "10.1.0.1/30",
            "listen_port": 51830,
            "peer": {
              "public_key": "下一跳节点的公钥（line_tunnels.to_wg_public_key）",
              "allowed_ips": "0.0.0.0/0",
              "endpoint": "下一跳节点公网IP:51830"
            }
          }
        ],
        "iptables_rules": [
          "iptables -A FORWARD -i wm-wg0 -o wm-tun1 -m comment --comment 'wm-line-3' -j ACCEPT",
          "iptables -A FORWARD -i wm-tun1 -o wm-wg0 -m comment --comment 'wm-line-3' -j ACCEPT"
        ]
      },
      {
        "line_id": 5,
        "line_name": "备用线路",
        "role": "relay",
        "interfaces": [
          {
            "name": "wm-tun2",
            "direction": "upstream",
            "private_key": "本节点在上游隧道的私钥（line_tunnels[hop_index=0].to_wg_private_key）",
            "address": "10.1.0.2/30",
            "listen_port": 51831,
            "peer": {
              "public_key": "上一跳节点的公钥",
              "allowed_ips": "10.1.0.0/30",
              "endpoint": "上一跳节点公网IP:51830"
            }
          },
          {
            "name": "wm-tun3",
            "direction": "downstream",
            "private_key": "本节点在下游隧道的私钥（line_tunnels[hop_index=1].from_wg_private_key）",
            "address": "10.1.0.5/30",
            "listen_port": 51832,
            "peer": {
              "public_key": "下一跳节点的公钥",
              "allowed_ips": "0.0.0.0/0",
              "endpoint": "下一跳节点公网IP:51832"
            }
          }
        ],
        "iptables_rules": [
          "iptables -A FORWARD -i wm-tun2 -o wm-tun3 -m comment --comment 'wm-line-5' -j ACCEPT",
          "iptables -A FORWARD -i wm-tun3 -o wm-tun2 -m comment --comment 'wm-line-5' -j ACCEPT"
        ]
      }
    ],
    "xray": {
      "enabled": true,
      "protocol": "vless",
      "transport": "ws",
      "port": 443,
      "config": { ... }
    },
    "version": "2026-04-06T10:00:00Z"
  }
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `node` | 节点自身的基本信息和 WireGuard 主接口（wm-wg0）配置 |
| `peers` | wm-wg0 上需要配置的所有 Peer（接入该节点的设备） |
| `tunnels` | 该节点参与的所有线路隧道配置。每个 tunnel 包含 `interfaces` 数组（entry/exit 有 1 个接口，relay 有 2 个）和 iptables 规则。数据来源于 `line_tunnels` 表 |
| `xray` | Xray 服务配置（未启用时 enabled=false） |
| `version` | 配置版本时间戳，Agent 用于判断是否需要更新 |

**tunnels 中的角色差异：**

| 角色 | 接口数量 | 说明 |
|------|----------|------|
| entry | 1 个 | 一个下游隧道接口，转发 wm-wg0 设备流量到下一跳 |
| relay | 2 个 | 一个上游接口（接收上一跳流量）+ 一个下游接口（转发到下一跳） |
| exit | 1 个 | 一个上游隧道接口，将流量 NAT 出站到互联网 |

Agent 收到配置后的处理流程：

1. 对比 `version` 与本地缓存版本，相同则跳过
2. **wm-wg0 Peer 更新**：更新 `/etc/wiremesh/wireguard/wm-wg0.conf` 中的 Peer 列表，执行 `wg syncconf wm-wg0 /etc/wiremesh/wireguard/wm-wg0.conf`
3. **隧道接口同步**：对比新 tunnels 列表与本地活跃接口状态，执行新增/更新/销毁操作（见 4.4.1）
4. **iptables 同步**：清理已失效线路的 iptables 规则（按 comment 标签），添加新线路的规则（见 4.4.2）
5. 如 Xray 启用，更新 Xray 配置文件并 reload 服务
6. 上报成功或失败状态

### 5.13 Agent 状态上报结构

`POST /api/agent/status` 请求体：

```json
{
  "node_id": 1,
  "is_online": true,
  "latency": 45,
  "transfers": [
    {
      "peer_public_key": "设备WG公钥",
      "upload_bytes": 1048576,
      "download_bytes": 5242880
    }
  ],
  "handshakes": [
    {
      "peer_public_key": "设备WG公钥",
      "last_handshake": "2026-04-06T10:30:00Z"
    }
  ]
}
```

### 5.14 分页约定

所有列表 API 支持统一的分页参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| page | 页码 | 1 |
| pageSize | 每页条数 | 20 |
| search | 搜索关键词（名称、IP 等） | — |
| status | 状态筛选 | — |
| tags | 标签筛选 | — |
| sortBy | 排序字段 | created_at |
| sortOrder | 排序方向 asc/desc | desc |

响应格式：

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

---

## 6. 数据库设计

### 6.1 ER 关系图

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│  nodes   │◄──────│ line_nodes   │──────►│  lines   │
│          │  1:N  │ (hop_order)  │  N:1  │          │
│          │       └──────────────┘       │          │
│          │                              │          │
│          │◄──────┌──────────────┐──────►│          │
│          │  1:N  │ line_tunnels │  N:1  │          │
└──────────┘       │ (两端密钥/IP) │       └────┬─────┘
     │             └──────────────┘             │
     │ 1:N                                1:N  │
     ▼                                         ▼
┌──────────────┐                     ┌──────────────┐
│ node_status  │                     │   devices    │
│ (监控记录)    │                     │ (line_id FK) │
└──────────────┘                     └──────────────┘
                                           
┌──────────┐       ┌──────────────┐       ┌──────────┐
│ filters  │◄──────│ line_filters │──────►│  lines   │
│          │  1:N  │              │  N:1  │          │
└──────────┘       └──────────────┘       └──────────┘

┌──────────┐       ┌──────────────┐
│  users   │       │  settings    │
│ (管理员)  │       │ (key-value)  │
└──────────┘       └──────────────┘

┌──────────────┐
│ audit_logs   │
│ (操作日志)    │
└──────────────┘
```

### 6.2 users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| username | string | 用户名（唯一） |
| password_hash | string | 密码哈希（bcrypt） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.3 settings 表

| 字段 | 类型 | 说明 |
|------|------|------|
| key | string (PK) | 设置项键名 |
| value | text | 设置项值 |
| updated_at | datetime | 更新时间 |

### 6.4 IP 地址自动分配

系统管理两套独立的 IP 地址空间：

#### 6.4.1 设备接入网段（wm-wg0）

基于 `wg_default_subnet`（默认 `10.0.0.0/24`）分配：

- **节点**：从第 `wg_node_ip_start` 位开始（默认 .1），如 10.0.0.1, 10.0.0.2, ...
- **设备**：从第 `wg_device_ip_start` 位开始（默认 .100），如 10.0.0.100, 10.0.0.101, ...

**分配逻辑：**

1. 查询 nodes/devices 表中所有已使用的 wg_address
2. 在对应范围内找下一个空闲 IP（已删除的 IP 可复用）
3. 写入 wg_address 字段
4. 创建时自动分配，编辑时不可修改（避免冲突）

#### 6.4.2 隧道网段（wm-tun1, wm-tun2, ...）

基于 `tunnel_subnet`（默认 `10.1.0.0/16`）分配，用于节点间的点对点隧道：

- 每条隧道链路（两个相邻节点之间）分配一个 **/30 子网**（4 个 IP，2 个可用）
- 低 hop_order 端分配 .1，高 hop_order 端分配 .2

**分配示例（线路 A→B→C）：**

```
A↔B 隧道：10.1.0.0/30  →  A 端 10.1.0.1, B 端 10.1.0.2
B↔C 隧道：10.1.0.4/30  →  B 端 10.1.0.5, C 端 10.1.0.6
```

**分配逻辑：**

1. 查询 line_tunnels 表中所有已使用的 from_wg_address / to_wg_address
2. 从 `tunnel_subnet` 中找下一个空闲的 /30 子网
3. 为 line_tunnels 记录写入 from 端 .1 和 to 端 .2 地址
4. 线路删除时释放 /30 子网，可复用

**隧道端口分配：**

- 从 `tunnel_port_start`（默认 51830）开始递增分配
- 查询 line_tunnels 表中所有已使用的端口，找下一个空闲端口
- 同一节点上的不同隧道使用不同端口（如 51830, 51831, ...）

### 6.5 表清单

| 表名 | 说明 |
|------|------|
| users | 管理员账号 |
| nodes | VPN 节点（服务器） |
| node_status | 节点状态监控记录（保留 7 天） |
| lines | 网络线路 |
| line_nodes | 线路-节点关联（含跳数顺序和角色） |
| line_tunnels | 线路隧道（每条隧道两端的密钥对、地址和端口） |
| devices | 客户端接入点 |
| filters | 分流规则 |
| line_filters | 线路-分流规则关联 |
| settings | 系统设置（key-value） |
| audit_logs | 操作日志 |

---

## 7. 页面结构

```
/setup                          # 首次启动初始化页

/login                          # 登录页

/dashboard                      # 仪表盘（首页）

/nodes                          # 节点列表
/nodes/new                      # 新增节点
/nodes/:id                      # 节点详情/编辑
/nodes/:id/script               # 安装脚本查看/复制

/devices                        # 设备列表
/devices/new                    # 新增设备
/devices/:id                    # 设备详情/编辑
/devices/:id/config             # 客户端配置下载

/lines                          # 线路列表
/lines/new                      # 新增线路（节点编排）
/lines/:id                      # 线路详情/编辑

/filters                        # 分流规则列表
/filters/new                    # 新增规则
/filters/:id                    # 规则详情/编辑

/settings                       # 系统设置
/settings/logs                  # 操作日志
```

---

## 8. 后台任务（Worker）

Worker 进程与 Next.js 运行在同一容器内，通过 `node worker/index.js` 启动。

| 任务 | 频率 | 说明 |
|------|------|------|
| 节点状态检测 | 可配置（默认 5 分钟） | 检查 Agent SSE 连接是否存活，标记掉线节点为 offline |
| 线路状态同步 | 与节点检测同步 | 根据节点在线状态更新线路可用性 |
| 监控数据清理 | 每天凌晨 | 清理 7 天前的 node_status 记录 |

---

## 9. 安装脚本生成逻辑

管理员新增节点后，系统生成一键安装 bash 脚本，内容包括：

```bash
#!/bin/bash
# === WireMesh Node Install Script ===
# Node: {node.name}
# Generated: {timestamp}

set -e

# 1. 创建目录
mkdir -p /etc/wiremesh/wireguard

# 2. 安装 WireGuard
apt-get update && apt-get install -y wireguard

# 3. 写入 WireGuard 配置
cat > /etc/wiremesh/wireguard/wm-wg0.conf << 'EOF'
[Interface]
PrivateKey = {node.wg_private_key}
Address = {node.wg_address}
ListenPort = {node.port}

# Peers 由 Agent 动态管理
EOF

# 4. 启动 WireGuard
systemctl enable wg-quick@wm-wg0
systemctl start wg-quick@wm-wg0

# 5. 安装 Xray（如启用）
# ...Xray 安装和配置...

# 6. 配置 IP 转发
echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
sysctl -p

# 7. 下载并安装 Agent
curl -fsSL {server_url}/api/agent/binary -o /usr/local/bin/wiremesh-agent
chmod +x /usr/local/bin/wiremesh-agent

# 8. 写入 Agent 配置
cat > /etc/wiremesh/agent.yaml << 'EOF'
server_url: "{server_url}"
node_id: {node.id}
token: "{node.agent_token}"
report_interval: 300
EOF

# 9. 注册 Agent systemd 服务
cat > /etc/systemd/system/wiremesh-agent.service << 'EOF'
[Unit]
Description=WireMesh Node Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/wiremesh-agent
Restart=always
RestartSec=5
WorkingDirectory=/etc/wiremesh

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable wiremesh-agent
systemctl start wiremesh-agent

# Agent 启动后会自动连接管理平台并上报安装完成状态
echo "Installation complete. Agent is connecting to management platform..."
```

---

## 10. Docker 部署

### 10.1 docker-compose.yml

```yaml
version: '3.8'
services:
  wiremesh:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data          # SQLite 数据持久化
    environment:
      - DATABASE_URL=file:/app/data/wiremesh.db
      - JWT_SECRET=xxx
      - ENCRYPTION_KEY=xxx        # AES-256-GCM 加密密钥
    restart: unless-stopped
```

### 10.2 Dockerfile

```dockerfile
FROM node:20-alpine AS base

# 安装 Go 编译 Agent
FROM golang:1.22-alpine AS agent-builder
WORKDIR /agent
COPY agent/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o wiremesh-agent .

# 构建 Next.js
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行
FROM base AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=agent-builder /agent/wiremesh-agent ./public/agent/wiremesh-agent-linux-amd64
COPY worker/ ./worker/

# 启动 Next.js + Worker
CMD ["sh", "-c", "node worker/index.js & node server.js"]
```

---

## 11. 敏感数据加密

### 11.1 加密方案

使用 AES-256-GCM 对称加密，密钥通过环境变量 `ENCRYPTION_KEY` 注入。

### 11.2 加密字段

| 表 | 字段 | 说明 |
|----|------|------|
| nodes | wg_private_key | 节点 WireGuard 私钥（wm-wg0 设备接入用） |
| devices | wg_private_key | 设备 WireGuard 私钥 |
| line_tunnels | from_wg_private_key | 隧道 from 端 WireGuard 私钥 |
| line_tunnels | to_wg_private_key | 隧道 to 端 WireGuard 私钥 |

### 11.3 加密流程

```
存储：明文 → AES-256-GCM 加密 → Base64 编码 → 存入 SQLite
读取：SQLite → Base64 解码 → AES-256-GCM 解密 → 明文
```

每次加密使用随机 IV（12 字节），与密文一起存储。

---

## 12. 非功能性需求

| 项目 | 要求 |
|------|------|
| 响应式 | 适配桌面和平板，不需要移动端优化 |
| 安全 | 敏感数据 AES-256-GCM 加密存储；管理 API 全部需要 JWT 认证；Agent API 使用节点级 Token 认证 |
| 性能 | SQLite 足以支撑单管理员使用场景；服务端分页避免大量数据传输 |
| 日志 | 关键操作日志记录到 SQLite audit_logs 表 |
| 国际化 | 仅中文 |
| 错误处理 | 配置同步/安装失败时记录错误信息，Dashboard 高亮提示，管理员手动处理 |
