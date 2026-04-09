# Xray 设备在线状态

## 概述

为 Xray 协议的设备增加在线/离线状态显示，与 WireGuard 设备体验一致。利用 Xray 内置的 Stats 模块 + UserOnline 策略，通过 `xray api` 命令行采集在线用户，复用现有的状态上报和展示链路。

## 背景

当前 WireGuard 设备通过 `wg show latest-handshakes` 采集握手时间，10 分钟阈值判断在线/离线。Xray 设备因无对应机制，状态固定显示为 "-"（未知）。

Xray 从 2021 年起支持 `statsUserOnline` 策略，可追踪当前有活跃连接的用户。结合 `xray api getallonlineusers` 命令行查询，可以零依赖（无需 gRPC 客户端）实现在线状态采集。

## 设计

### 1. Xray 配置变更（agent/xray/config.go）

在生成的 Xray JSON 配置中增加以下内容：

**新增顶层模块：**

```json
{
  "stats": {},
  "api": {
    "tag": "api",
    "services": ["StatsService"]
  },
  "policy": {
    "levels": {
      "0": {
        "statsUserOnline": true
      }
    }
  }
}
```

**新增 dokodemo-door 入站（gRPC API 端口）：**

```json
{
  "tag": "api-in",
  "listen": "127.0.0.1",
  "port": 41380,
  "protocol": "dokodemo-door",
  "settings": {
    "address": "127.0.0.1"
  }
}
```

端口选择 41380，遵循项目的 41xxx 端口规范，仅监听 127.0.0.1（本地访问）。

**新增路由规则（置于其他规则之前）：**

```json
{
  "type": "field",
  "inboundTag": ["api-in"],
  "outboundTag": "api"
}
```

**每个 VLESS 客户端增加 email 和 level 字段：**

```json
{
  "id": "设备的 xrayUuid",
  "email": "设备的 xrayUuid",
  "level": 0,
  "flow": "xtls-rprx-vision"
}
```

`email` 设为 `xrayUuid`，用于 Stats 模块标识用户。`level: 0` 对应 policy 中启用了 `statsUserOnline` 的等级。

### 2. Agent 采集（agent/collector/collector.go）

新增 `collectXrayOnlineUsers()` 方法：

```
执行: xray api getallonlineusers -s 127.0.0.1:41380 --json
输出: {"users": ["uuid1", "uuid2", ...]}
```

处理逻辑：
- 如果 xray 进程未运行或命令执行失败，返回空列表（不报错）
- 解析 JSON 输出，提取 users 数组
- 返回 `[]string`，即在线用户的 UUID 列表

在 `Collect()` 方法中调用，与 WG handshake 采集并列。

### 3. 状态上报协议（agent/api/status.go）

`StatusReport` 结构体新增字段：

```go
XrayOnlineUsers []string `json:"xray_online_users,omitempty"`
```

上报 JSON 示例：

```json
{
  "is_online": true,
  "latency": 42,
  "transfers": [...],
  "handshakes": [...],
  "xray_online_users": ["uuid-aaa", "uuid-bbb"]
}
```

### 4. 管理平台 API（src/app/api/agent/status/route.ts）

处理 `xray_online_users` 字段：

1. 收到上报后，遍历 `xray_online_users` 数组
2. 对每个 UUID，通过 `WHERE xray_uuid = ?` 查询设备
3. 匹配到的设备：更新 `lastHandshake = new Date().toISOString()`
4. 不在列表中的 Xray 设备：不做任何操作（依靠 lastHandshake 自然过期）

这样 Xray 设备复用了 WG 设备已有的 `lastHandshake` + 10 分钟阈值逻辑。

### 5. 设备状态计算（src/lib/device-status.ts）

移除 Xray 特殊处理：

```typescript
// 删除这行:
// if (protocol === "xray") return "-";

// Xray 和 WireGuard 统一使用 lastHandshake 判断
return isDeviceOnline(lastHandshake) ? "online" : "offline";
```

### 6. 设备列表 API（src/app/api/devices/route.ts）

设备列表 API 的 `status` 筛选已经基于 `lastHandshake` 阈值查询，无需修改即可自动覆盖 Xray 设备。

### 7. 前端（src/app/(dashboard)/devices/page.tsx）

无需修改。状态 badge 已支持 "online" / "offline" 显示，去掉 "-" 状态后 Xray 设备自然显示为 online 或 offline。

## 数据流

```
Xray 客户端连接
  → Xray Stats 模块记录 email(uuid) 在线
    → Agent 定时执行 xray api getallonlineusers
      → Agent POST /api/agent/status { xray_online_users: [...] }
        → 管理平台更新匹配设备的 lastHandshake
          → 前端查询时 computeDeviceStatus() 返回 online/offline
```

## 变更范围

| 文件 | 变更 |
|------|------|
| `agent/xray/config.go` | 添加 stats/api/policy 模块、dokodemo-door 入站、路由规则、client email 字段 |
| `agent/collector/collector.go` | 新增 `collectXrayOnlineUsers()` 方法 |
| `agent/api/status.go` | StatusReport 添加 `XrayOnlineUsers` 字段 |
| `src/app/api/agent/status/route.ts` | 处理 `xray_online_users`，更新 Xray 设备 lastHandshake |
| `src/lib/device-status.ts` | 移除 `if (protocol === "xray") return "-"` |

## 不变的部分

- 数据库 schema 无需修改（复用 lastHandshake 字段）
- 设备列表 API 筛选逻辑无需修改
- 前端 UI 组件无需修改
- 10 分钟在线阈值保持一致
- Agent 上报频率不变

## 注意事项

- **Xray "在线" 语义**：表示客户端有活跃连接通过 Xray。完全空闲（无任何请求）的客户端会显示离线，这是代理模式的固有特性，实际使用中客户端通常有后台连接保持活跃
- **Stats API 端口 41380**：仅监听 127.0.0.1，不暴露到外网
- **向后兼容**：`xray_online_users` 使用 `omitempty`，旧版 Agent 不发送此字段，平台无影响
- **Xray 未运行时**：Agent 采集静默返回空列表，不影响 WG 状态上报
