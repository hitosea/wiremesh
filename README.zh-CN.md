# WireMesh

[English](README.md)

WireGuard 网状网络管理平台，用于管理 VPN 节点、客户端设备、网络线路和隧道配置。

## 功能

- **节点管理** — 添加 VPN 节点，一键安装脚本部署 Agent，支持 Ubuntu/Debian/CentOS/RHEL/Rocky/AlmaLinux/Fedora，x86_64 和 ARM64
- **设备管理** — 支持 WireGuard、Xray (VLESS Reality) 和 SOCKS5 三种协议，自动生成客户端配置
- **线路管理** — 多跳线路编排（入口→中转→出口），自动生成隧道密钥和配置
- **仪表盘** — 节点/设备/线路状态总览、流量统计、在线监控
- **系统设置** — 自定义网段、端口、DNS，操作审计日志

## 架构

```
┌────────────────────────────────┐
│     Docker Container (管理平台)  │
│                                │
│  Next.js (Web+API+SSE)        │
│  Worker (定时任务+状态检测)      │
│  SQLite                        │
└───────────────┬────────────────┘
                │ SSE + HTTP
        ┌───────┴───────┐
        ▼               ▼
   Node Agent      Node Agent
   (Go 二进制)      (Go 二进制)
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 全栈框架 | Next.js (App Router) |
| 前端 | React 19 + TypeScript + shadcn/ui + Tailwind CSS |
| 数据库 | SQLite (Drizzle ORM) |
| 节点 Agent | Go 单二进制 |
| VPN 协议 | WireGuard + Xray (VLESS Reality) + SOCKS5 |
| 部署 | Docker Compose |

## 快速开始

### 1. 部署管理平台

**使用预构建镜像（推荐）：**

```bash
# 下载 docker-compose.yml 后编辑 PUBLIC_URL
docker compose up -d
```

镜像地址：`ghcr.io/hitosea/wiremesh:latest`，支持 amd64 和 arm64。

**从源码构建：**

```bash
git clone <repo-url> wiremesh
cd wiremesh
cp .env.example .env
# 编辑 .env，设置 PUBLIC_URL
docker compose up -d --build
```

访问 `http://服务器IP:3456`，首次打开会进入初始化页面。

### 2. 添加节点

在管理平台中添加节点，然后在节点详情页获取一键安装命令，在目标服务器上以 root 执行即可。

### 3. 创建线路

选择入口节点和出口节点（可选中转节点），系统自动生成隧道密钥和配置。

### 4. 添加设备

创建设备，选择协议（WireGuard、Xray 或 SOCKS5），绑定到线路，下载客户端配置即可使用。

## 节点要求

- Linux（Ubuntu 20+、Debian 11+、CentOS 8+、RHEL、Rocky、AlmaLinux、Fedora）
- x86_64 或 ARM64，内核 5.6+
- 公网 IP
- 防火墙开放：UDP 41820（设备接入）、UDP 41830+（节点间隧道）、TCP 41443+（Xray / SOCKS5 接入）

## 开发

```bash
npm install
npm run dev -- --port 3000 --hostname 0.0.0.0

# 测试
npm run test
cd agent && go test ./...
```

详细的架构设计、API 接口、Agent 协议等见 [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md)。

## 发布

推送到 `main` 分支即可自动构建并发布 Docker 镜像到 GHCR：

```bash
docker compose pull && docker compose up -d
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PUBLIC_URL` | 管理平台公网地址（用于安装脚本中的 URL） | `http://localhost:3456` |
| `JWT_SECRET` | JWT 签名密钥（至少 32 字符） | 已内置 |
| `ENCRYPTION_KEY` | AES-256-GCM 密钥（64 位十六进制字符串） | 已内置 |

## License

MIT
