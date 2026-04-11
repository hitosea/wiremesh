# 代理设置重构 + 节点端口列

## 背景

当前节点的 `xrayEnabled` 开关仅控制 Xray，但 SOCKS5 实际不受该开关控制且共用端口池，导致语义矛盾。同时用户希望在节点列表中直观看到每个节点需要放行的端口。

## 变更范围

### 一、移除 xrayEnabled 开关

**原因**：Xray 和 SOCKS5 均为预装服务，是否生效由线路编排决定（节点是否为入口 + 线路是否绑定对应协议的设备），无需手动开关。

#### 1.1 数据库 Schema

- 从 `src/lib/db/schema.ts` 的 `nodes` 表定义中移除 `xrayEnabled` 字段
- 修改初始迁移文件 `drizzle/0000_striped_the_call.sql`，删除 `xray_enabled` 列定义
- **不做列删除迁移**，已安装的系统保留该列，不影响运行

#### 1.2 节点创建 API (`POST /api/nodes`)

- 移除 `xrayEnabled` 参数处理
- **始终生成 Reality 密钥对**（privateKey/publicKey/shortId），始终写入 `xrayConfig`
- 始终设置 `xrayProtocol: "vless"`, `xrayTransport: "tcp"`
- `xrayPort` 始终写入（用户指定值或系统默认值）

#### 1.3 节点更新 API (`PUT /api/nodes/[id]`)

- 移除 `xrayEnabled` 参数处理
- Reality dest 更新逻辑保持不变
- 如果节点之前没有 `xrayConfig`（旧数据），更新时自动补生成

#### 1.4 Agent 配置下发 (`GET /api/agent/config`)

- Xray 配置生成条件：`if (node.xrayEnabled && node.xrayConfig)` → `if (node.xrayConfig)`
- SOCKS5 配置生成：不变（本来就不检查 xrayEnabled）

#### 1.5 节点创建/编辑表单

- 分组标题：`"Xray 设置"` → `"Xray / SOCKS5 设置"`
- 移除 Switch 开关及 `xrayEnabled` 状态
- 端口输入框和 Reality dest 输入框始终显示（不再嵌套在条件渲染中）
- Reality dest 描述中说明这是 Xray 专用设置

### 二、节点列表新增端口列

#### 2.1 API 层 (`GET /api/nodes`)

为每个节点计算关联端口，在返回数据中增加 `ports` 字段：

```typescript
type NodePorts = {
  wg: number;           // nodes.port — WireGuard 主端口 (UDP)
  proxy: number;        // 代理起始端口 (TCP)，即 xrayPort 或系统默认值
  tunnels: number[];    // line_tunnels 中关联的隧道端口 (UDP)
  socks5: number[];     // 计算得出的 SOCKS5 端口 (TCP)
}
```

查询逻辑：
1. `wg` — 直接取 `nodes.port`
2. `proxy` — 直接取 `nodes.xrayPort`（仅当有 xray 设备绑定到该节点入口线路时才包含）
3. `tunnels` — 查询 `line_tunnels` 表，`fromNodeId = nodeId` 取 `fromWgPort`，`toNodeId = nodeId` 取 `toWgPort`，去重
4. `socks5` — 对该节点作为入口（`hopOrder=0`）的每条有 socks5 设备的线路，调用 `getProxyPortForLine()` 计算

#### 2.2 UI 层

在节点列表「状态」列和「操作」列之间新增「端口」列：

- **默认显示**：端口总数，如 `3 个端口`
- **点击/悬停**：弹出 Popover，按类型分组显示：

```
WG/UDP:      51820
Xray/TCP:    41443
隧道/UDP:    41830, 41831
SOCKS5/TCP:  41444
```

- 没有端口的分组不显示
- Xray 和 SOCKS5 端口仅在该节点实际作为入口且有对应设备时才出现

### 三、国际化

#### 修改的翻译 key（zh-CN / en）

nodes 命名空间：

| key | zh-CN | en |
|-----|-------|----|
| `xraySettings` | `Xray / SOCKS5 设置` | `Xray / SOCKS5 Settings` |
| `realityTargetHint` | `Xray 伪装目标，需支持 TLS 1.3，如 www.microsoft.com:443` | `Xray camouflage target, must support TLS 1.3, e.g., www.microsoft.com:443` |
| `portsCol` | `端口` | `Ports` |
| `portsCount` | `{count} 个端口` | `{count} ports` |
| `portsWg` | `WG/UDP` | `WG/UDP` |
| `portsXray` | `Xray/TCP` | `Xray/TCP` |
| `portsTunnel` | `隧道/UDP` | `Tunnel/UDP` |
| `portsSocks5` | `SOCKS5/TCP` | `SOCKS5/TCP` |

#### 删除的翻译 key

| key | 原因 |
|-----|------|
| `enableXray` | 开关已移除 |

## 涉及文件清单

| 文件 | 变更类型 |
|------|----------|
| `src/lib/db/schema.ts` | 移除 xrayEnabled 字段 |
| `drizzle/0000_striped_the_call.sql` | 移除 xray_enabled 列 |
| `src/app/api/nodes/route.ts` | 创建节点始终生成 Reality 密钥 |
| `src/app/api/nodes/[id]/route.ts` | 更新逻辑移除 xrayEnabled |
| `src/app/api/agent/config/route.ts` | Xray 配置条件改为仅检查 xrayConfig |
| `src/app/(dashboard)/nodes/new/page.tsx` | 移除开关，调整表单 |
| `src/app/(dashboard)/nodes/[id]/page.tsx` | 移除开关，调整表单 |
| `src/app/(dashboard)/nodes/page.tsx` | 新增端口列 |
| `messages/zh-CN.json` | 更新翻译 |
| `messages/en.json` | 更新翻译 |
