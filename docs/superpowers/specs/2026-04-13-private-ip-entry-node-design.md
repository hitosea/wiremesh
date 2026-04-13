# 支持内网 IP 入口节点

## 背景

当前 WireMesh 隐式假设所有节点都有公网 IP。实际使用中，入口节点可能部署在本地局域网（无公网 IP），设备与入口在同一局域网内直连，只有出口/中继节点有公网 IP。

## 需求

- 节点可以填写内网 IP（192.168.x.x、10.x.x.x 等）
- 内网 IP 节点只能作为入口节点，不能作为中继或出口
- 系统通过 RFC 1918 自动检测私有 IP，无需手动标记
- 隧道建立时，公网节点不尝试反连内网节点

## 设计

### 1. `isPrivateIp()` 工具函数

**文件**: `src/lib/ip-utils.ts`（新建）

纯函数，前后端共用。使用数值比较（非正则），可读性更好。

```typescript
export function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  // RFC 1918
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Loopback
  if (parts[0] === 127) return true;
  // Link-local
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}
```

覆盖范围：10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、127.0.0.0/8、169.254.0.0/16。

### 2. Agent 配置生成 — Endpoint 跳过

**文件**: `src/app/api/agent/config/route.ts`

在生成隧道配置时，当 to 端需要连 from 端、但 from 端是私有 IP 时，`peerAddress` 传空字符串：

- 第 130 行（当前节点是 from，对端是 to）：不变，正常返回 to 节点的公网 IP
- 第 138 行（当前节点是 to，对端是 from）：如果 from 节点是私有 IP，传空字符串

```typescript
// 原逻辑
peerAddress = getNodePublicHost(tunnel.fromNodeId);
// 改为
const fromNode = nodeMap.get(tunnel.fromNodeId);
peerAddress = (fromNode && isPrivateIp(fromNode.ip)) ? "" : getNodePublicHost(tunnel.fromNodeId);
```

**文件**: `agent/wg/tunnel.go`

第 128 行，`peerAddress` 为空时不写 `Endpoint` 行：

```go
// 原逻辑
sb.WriteString(fmt.Sprintf("Endpoint = %s:%d\n", iface.PeerAddress, iface.PeerPort))
// 改为
if iface.PeerAddress != "" {
    sb.WriteString(fmt.Sprintf("Endpoint = %s:%d\n", iface.PeerAddress, iface.PeerPort))
}
```

私有 IP 入口节点主动连出口（设置 Endpoint），出口不反连入口（不设置 Endpoint）。WireGuard 靠 PersistentKeepalive=25 维持双向通信。

### 3. 线路创建 — 拓扑校验

**文件**: `src/app/api/lines/route.ts`（POST 处理）

在现有验证之后、创建隧道之前，遍历每个 branch 的 `nodeIds`，检查是否有私有 IP 节点：

```
对每个 branch 的 nodeIds：
  查出节点 ip
  如果 isPrivateIp(ip) → 返回错误 validation.privateIpNotAllowedAsRelayOrExit
```

入口节点 (`entryNodeId`) 不校验，内网公网都行。

线路编辑 (`PUT /api/lines/[id]`) 只能改 name/status/remark，不涉及节点变更，不需要改。

### 4. 前端线路表单 — 节点下拉置灰

**文件**: `src/app/(dashboard)/lines/new/page.tsx`

branch 的节点下拉列表中，对私有 IP 节点：

- `disabled` 不可选择
- 显示灰色样式
- 节点名后追加「(内网)」提示

入口节点下拉列表不受影响，内网公网都能选。

前端 import 共用的 `src/lib/ip-utils.ts`。

### 5. i18n 文案更新

**新增错误提示** (`validation.privateIpNotAllowedAsRelayOrExit`)：

- 中文：`节点 "{name}" 使用内网 IP，不能作为中继或出口节点`
- 英文：`Node "{name}" uses a private IP and cannot be used as relay or exit`

**更新 IP placeholder** (`ipPlaceholder`)：

- 中文：`例如 1.2.3.4 或 192.168.1.100`
- 英文：`e.g., 1.2.3.4 or 192.168.1.100`

## 不需要改动的地方

| 位置 | 原因 |
|------|------|
| 节点创建/编辑 API | 本来就没有 IP 格式校验，内网 IP 已能存入 |
| 数据库 schema | TEXT 类型，无需变更 |
| 设备配置生成 | 设备 Endpoint 指向入口节点，局域网内用内网 IP 能连 |
| 安装脚本 | 不嵌入节点 IP，不受影响 |
| wm-wg0 设备接入接口 | 入口节点监听 ListenPort，不涉及 Endpoint |
| 线路编辑 API | 只能改 name/status/remark，不涉及节点 |
| 节点列表页面 | 内网 IP 正常显示即可 |

## 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `src/lib/ip-utils.ts` | 新建 |
| `src/app/api/agent/config/route.ts` | 修改 |
| `agent/wg/tunnel.go` | 修改 |
| `src/app/api/lines/route.ts` | 修改 |
| `src/app/(dashboard)/lines/new/page.tsx` | 修改 |
| `messages/zh-CN.json` | 修改 |
| `messages/en.json` | 修改 |
