# WireMesh

WireGuard 网状网络管理平台，用于管理 VPN 节点、客户端设备、网络线路和隧道配置。

## 功能

- **节点管理** — 添加 VPN 节点（云服务器），一键安装脚本部署 Agent，支持 Ubuntu/Debian/CentOS/RHEL/Rocky/AlmaLinux/Fedora，x86_64 和 ARM64 架构
- **设备管理** — 管理客户端接入点，支持 WireGuard 和 Xray (VLESS Reality) 双协议，自动生成客户端配置
- **线路管理** — 灵活的多跳线路编排（入口→中转→出口），自动生成隧道密钥、IP 和端口，同一节点可同时参与多条线路
- **Agent 自动配置** — 节点 Agent 通过 SSE 接收配置推送，自动管理 WireGuard 接口、隧道、iptables 规则和策略路由
- **Xray Reality** — 入口节点可启用 Xray VLESS Reality 接入，流量自动通过 fwmark 路由到正确的隧道链
- **仪表盘** — 节点/设备/线路状态总览、流量统计、在线状态监控
- **设备流量统计** — 按设备累计上行/下行流量（增量上报）
- **节点状态历史** — 延迟和流量趋势图表
- **系统设置** — 自定义网段、端口、DNS 等参数
- **操作日志** — 关键操作审计记录

## 架构

```
┌──────────────────────────────────────┐
│       Docker Container (管理平台)      │
│                                      │
│  ┌───────────┐  ┌──────────────────┐ │
│  │  Next.js   │  │  Worker          │ │
│  │  (Web+API  │  │  (定时任务       │ │
│  │   +SSE)    │  │   +状态检测)     │ │
│  └─────┬─────┘  └───────┬──────────┘ │
│        └────────┬────────┘            │
│          ┌──────┴──────┐              │
│          │   SQLite    │              │
│          └─────────────┘              │
└──────────────────────────────────────┘
         ▲                    
         │ SSE + HTTP          
         ▼                    
┌─────────────────┐  ┌─────────────────┐
│  Node Agent     │  │  Node Agent     │
│  (Go 二进制)     │  │  (Go 二进制)     │
│  WireGuard      │  │  WireGuard      │
│  + Xray         │  │  + Xray         │
└─────────────────┘  └─────────────────┘
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 全栈框架 | Next.js (App Router) |
| 前端 | React 18 + TypeScript + shadcn/ui + Tailwind CSS |
| 数据库 | SQLite (Drizzle ORM) |
| 节点 Agent | Go 单二进制，无运行时依赖 |
| VPN 协议 | WireGuard + Xray (VLESS Reality) |
| 加密 | AES-256-GCM（私钥加密存储） |
| 部署 | Docker Compose |

## 快速开始

### 1. 部署管理平台

```bash
git clone <repo-url> wiremesh
cd wiremesh

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，设置 JWT_SECRET 和 ENCRYPTION_KEY

# 启动
docker compose up -d --build
```

访问 `http://服务器IP:3000`，首次打开会进入初始化页面。

### 2. 添加节点

在管理平台中添加节点（填写服务器公网 IP），然后在节点详情页获取一键安装命令：

```bash
curl -fsSL 'https://管理平台地址/api/nodes/1/script?token=xxx' | bash
```

在目标服务器上以 root 执行即可。脚本会自动：
- 检测系统环境（OS、架构、内核）
- 安装 WireGuard、iptables、Xray
- 下载并启动 Agent
- 连接管理平台并上线

### 3. 创建线路

选择入口节点和出口节点（可选中转节点），系统自动生成隧道密钥和配置。

### 4. 添加设备

创建设备（WireGuard 或 Xray 协议），绑定到线路，下载客户端配置即可使用。

## 默认配置

| 项目 | 默认值 |
|------|--------|
| 设备接入网段 | 10.210.0.0/24 |
| 隧道网段 | 10.211.0.0/16 |
| WireGuard 端口 | 41820/udp |
| 隧道端口起始 | 41830/udp |

选用 10.210/10.211 网段和 41xxx 端口以避免与 Docker、Kubernetes、云厂商 VPC 等常见软件冲突。所有默认值可在系统设置中修改。

## 项目结构

```
wiremesh/
├── src/                        # Next.js 管理平台 (App Router)
│   ├── app/                    # 页面和 API 路由
│   │   ├── (auth)/             # 登录、初始化页面
│   │   ├── (dashboard)/        # 管理页面（节点/设备/线路/设置等）
│   │   └── api/                # API 端点
│   │       ├── agent/          # Agent 通信 API（SSE/配置/状态）
│   │       ├── nodes/          # 节点 CRUD
│   │       ├── devices/        # 设备 CRUD
│   │       ├── lines/          # 线路 CRUD
│   │       └── ...
│   ├── lib/                    # 工具库（加密、认证、IP 分配等）
│   └── components/             # React 组件
├── agent/                      # Go Agent 源码
│   ├── agent/                  # 核心编排器（SSE→配置→应用）
│   ├── api/                    # HTTP/SSE 客户端
│   ├── wg/                     # WireGuard 接口和隧道管理
│   ├── iptables/               # iptables 规则管理
│   ├── xray/                   # Xray 配置生成和服务管理
│   └── collector/              # 状态采集（流量/延迟/握手）
├── worker/                     # Worker 进程（定时任务）
├── docker-compose.yml
├── Dockerfile
└── docs/                       # 需求文档和架构图
```

## Agent 工作原理

```
Agent 启动
  ├── 上报安装完成 → 节点上线
  ├── 拉取配置 → 应用 WireGuard/隧道/iptables/路由/Xray
  ├── 连接 SSE → 接收配置变更通知 → 重新拉取并应用
  └── 定时上报状态（延迟、流量、握手）
```

- **WireGuard 设备**：per-device 源地址策略路由，不同设备走不同隧道
- **Xray 设备**：per-line fwmark 路由，Xray 按 UUID 匹配线路打 mark，内核策略路由到隧道
- **中转节点**：自动配置双向隧道转发
- **出口节点**：自动配置 NAT MASQUERADE + 回程路由

## 节点要求

- Linux（Ubuntu 20+、Debian 11+、CentOS 8+、RHEL、Rocky、AlmaLinux、Fedora）
- x86_64 或 ARM64 架构
- 内核 5.6+（内置 WireGuard 支持）
- 公网 IP
- 开放 UDP 端口（默认 41820 + 41830-41840）

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev -- --port 3000 --hostname 0.0.0.0

# 编译 Agent（打包为 tar.gz，放到 public/agent/ 供安装脚本下载）
cd agent
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tmp/wiremesh-agent -ldflags="-s -w" .
tar -czf ../public/agent/wiremesh-agent-linux-amd64.tar.gz -C /tmp wiremesh-agent
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o /tmp/wiremesh-agent -ldflags="-s -w" .
tar -czf ../public/agent/wiremesh-agent-linux-arm64.tar.gz -C /tmp wiremesh-agent

# 测试
npm run test              # Next.js 测试
cd agent && go test ./... # Go 测试

# Docker 构建
docker compose up -d --build
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | SQLite 数据库路径（如 `file:/app/data/wiremesh.db`） |
| `JWT_SECRET` | JWT 签名密钥（至少 32 字符） |
| `ENCRYPTION_KEY` | AES-256-GCM 密钥（64 位十六进制字符串） |
| `PUBLIC_URL` | 管理平台公网地址（用于安装脚本中的 URL） |

## License

MIT
