# WireMesh

WireGuard 网状网络管理平台，用于管理 VPN 节点、客户端设备、网络线路和分流规则。单管理员内部使用。

## 项目结构

```
wiremesh/
├── src/                    # Next.js 管理平台 (App Router)
├── agent/                  # Go Agent 源码（部署到每个节点服务器）
├── worker/                 # Node.js Worker 进程（定时任务）
├── docs/                   # 需求文档和架构图
│   ├── requirements.md     # 完整需求文档 v2.4（务必通读）
│   └── node-architecture.md # 节点架构图
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## 技术栈

- **全栈框架**: Next.js (App Router)
- **前端**: React 18 + TypeScript + shadcn/ui + Tailwind CSS
- **数据库**: SQLite (Drizzle ORM)
- **节点 Agent**: Go 单二进制，通过 SSE 接收通知 + HTTP POST 上报
- **VPN 协议**: WireGuard + Xray (VLESS + WS/gRPC)
- **加密**: AES-256-GCM，密钥通过环境变量 ENCRYPTION_KEY 注入
- **部署**: Docker Compose 单容器

## 核心架构决策

这些决策已确认，开发时不要偏离：

1. **节点无固定角色** — 节点表没有 role 字段，角色完全由线路编排（line_nodes）决定。同一节点可同时在不同线路中当入口/中转/出口
2. **SSE + HTTP POST（非 WebSocket）** — 管理平台通过 SSE 推送通知给 Agent，Agent 主动 HTTP GET 拉取配置、HTTP POST 上报状态。不使用 WebSocket
3. **Xray 仅作为入口层代理** — Xray 解密 VLESS 流量后注入 wm-wg0，后续全走 WireGuard 隧道。节点间不使用 Xray
4. **line_tunnels 表存储隧道密钥** — 每条隧道两端的密钥/地址/端口存在 line_tunnels 表（不是 line_nodes），中转节点出现在两行中
5. **WireGuard 接口隔离** — 配置目录 /etc/wiremesh/wireguard/，接口前缀 wm-（wm-wg0 设备接入，wm-tun1/2/3 隧道），不使用系统的 /etc/wireguard/
6. **IP 自动分配** — 设备接入网段 10.210.0.0/24（节点从 .1，设备从 .100），隧道网段 10.211.0.0/16（每条隧道 /30 子���），WireGuard 端口 41820，隧道端口从 41830 起。选用 10.210/10.211 网段和 41xxx 端口以避免与 Docker/K8s/云厂商 VPC 等常见软件冲突

## 命名规范

| 项目 | 命名 |
|------|------|
| Agent 二进制 | wiremesh-agent |
| systemd 服务 | wiremesh-agent.service |
| 配置目录 | /etc/wiremesh/ |
| 设备接入接口 | wm-wg0 |
| 隧道接口 | wm-tun1, wm-tun2, ... |
| iptables 标签 | wm-line-{id} |
| 数据库文件 | wiremesh.db |

## 开发注意事项

- 仅中文界面，不需要国际化
- 适配桌面和平板，不需要移动端优化
- 所有列表 API 使用服务端分页
- 敏感数据（WG 私钥）必须 AES-256-GCM 加密存储
- Agent 二进制仅编译 linux/amd64
- node_status 监控数据保留 7 天，Worker 定时清理
- 详细的 API 设计、数据库表结构、Agent 通信协议等见 docs/requirements.md
