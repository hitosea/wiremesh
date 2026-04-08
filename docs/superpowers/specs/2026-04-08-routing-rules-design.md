# 分流规则（Routing Rules）设计文档

> 版本: 1.0
> 日期: 2026-04-08

---

## 1. 概述

### 1.1 目标

为 WireMesh 平台实现分流规则功能，支持按目的地 IP/CIDR 和域名将流量路由到同一线路内的不同出口节点。

### 1.2 核心概念

- **线路**从单链模型（入口→中转→出口）扩展为**星型多分支模型**（一个入口 + 多条分支，每条分支可经可选中转到达不同出口）
- **分流规则**将目的 IP/CIDR 或域名映射到具体分支
- 未匹配的流量走线路的**默认分支**
- 优先级采用**最长前缀匹配**（longest-prefix-match），由 Linux `ip route` 天然支持

### 1.3 使用场景示例

一条线路配置：
- 分支1（默认）：入口A → 出口B（日本），兜底所有未匹配流量
- 分支2：入口A → 出口D（美国），匹配 Google/YouTube 等域名
- 分支3：入口A → 中转C → 出口E（欧洲），匹配特定 IP 段

---

## 2. 数据模型变更

### 2.1 新增 `line_branches` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| line_id | FK → lines | 所属线路 |
| name | string | 分支名称（如"日本出口"、"美国出口"） |
| is_default | boolean | 是否为默认分支（每条线路有且仅有一条） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 2.2 改造 `line_nodes`

新增 `branch_id` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| branch_id | FK → line_branches, nullable | 所属分支 |

- `branch_id = null` + `role = "entry"` → 线路级入口节点（所有分支共享）
- `branch_id = X` + `role = "relay" | "exit"` → 属于具体分支的中转或出口节点

### 2.3 改造 `line_tunnels`

新增 `branch_id` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| branch_id | FK → line_branches | 隧道所属分支 |

### 2.4 改造 `filters` 表

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| domain_rules | text? | 域名规则，每行一条（匹配域名及其所有子域名） |
| source_url | text? | 外部规则源 URL，为空则纯手动 |
| source_updated_at | text? | 上次从外部源同步的时间 |

原有 `rules` 字段保留，存储 IP/CIDR 规则。`rules` 和 `domain_rules` 可同时为空（仅当规则未配置内容时）。

### 2.5 删除 `line_filters`，新增 `branch_filters`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 自增主键 | — |
| branch_id | FK → line_branches | 关联分支 |
| filter_id | FK → filters | 关联分流规则 |

规则关联到分支而非线路。一条规则可关联多条分支（跨线路复用），一条分支可关联多条规则（合并生效）。

### 2.6 关系总览

```
line
  ├── entry node (line_nodes where branch_id is null, role=entry)
  └── branches[]
        ├── line_nodes (relay + exit, with branch_id)
        ├── line_tunnels (entry→relay→exit 隧道链)
        └── branch_filters → filters (分流规则)

device.line_id → line（不变）
```

---

## 3. 分流规则模型

### 3.1 规则内容格式

**IP/CIDR 格式**（`rules` 字段）：
```
1.0.0.0/24
223.5.5.0/24
10.0.0.1
```

每行一条，支持 `#` 注释行和空行，解析时跳过。API 校验每行为合法 IP 或 CIDR。

**域名格式**（`domain_rules` 字段）：
```
google.com
netflix.com
*.openai.com
```

语义为"匹配该域名及其所有子域名"（`google.com` 匹配 `google.com`、`www.google.com`、`mail.google.com` 等）。`*.` 前缀为可选的显式写法，效果相同。不支持关键字匹配。

### 3.2 白名单/黑名单模式

- **whitelist（代理匹配）**：匹配的目的 IP/域名走关联的分支
- **blacklist（排除匹配）**：匹配的目的 IP/域名不走关联的分支（回落到默认分支或其他匹配规则）

绝大多数场景使用 whitelist。

### 3.3 外部规则源

当 `source_url` 不为空时：

- Agent 内置定时器，定期 fetch URL 内容（默认每天一次）
- 自动分类：能解析为 IP/CIDR 的归 IP 规则，否则归域名规则
- 外部源内容和手动输入的内容用分隔标记区分：

```
# === 以下由外部源自动同步，请勿手动编辑 ===
1.0.0.0/24
1.1.1.0/24
...
# === 以下为手动添加 ===
192.168.100.0/24
```

- 同步时只覆盖外部源部分，保留手动追加部分
- 同步失败保留旧内容，上报错误给管理平台

### 3.4 默认分支

每条线路有且仅有一条 `is_default = true` 的分支。未匹配任何 IP/CIDR 且 DNS 也未命中域名规则的流量走默认分支。

---

## 4. Agent 配置下发

### 4.1 `/api/agent/config` 扩展

新增 `routing` 段，仅入口节点会收到：

```json
{
  "data": {
    "node": { "..." },
    "peers": [],
    "tunnels": { "..." },
    "xray": { "..." },
    "routing": {
      "enabled": true,
      "dns": {
        "listen": "10.210.0.1:53",
        "upstream": ["8.8.8.8", "1.1.1.1"]
      },
      "branches": [
        {
          "id": 1,
          "name": "日本出口",
          "is_default": true,
          "tunnel": "wm-tun1",
          "mark": 41001,
          "ip_rules": [],
          "domain_rules": [],
          "rule_sources": []
        },
        {
          "id": 2,
          "name": "美国出口",
          "is_default": false,
          "tunnel": "wm-tun2",
          "mark": 41002,
          "ip_rules": ["1.0.0.0/24", "223.5.5.0/24"],
          "domain_rules": ["google.com", "youtube.com"],
          "rule_sources": [
            {
              "filter_id": 5,
              "url": "https://example.com/us-domains.txt",
              "sync_interval": 86400
            }
          ]
        }
      ]
    }
  }
}
```

### 4.2 fwmark 分配

- **分支 fwmark：41001 起**（41001, 41002, 41003...）
- **Xray fwmark：42001 起**（原 201 起，调整以避免冲突）

使用 5 位数并以 `41`/`42` 为前缀，与项目端口风格一致（41820/41830），避免与系统或其他软件的 fwmark 冲突。

---

## 5. Agent Linux 实现

### 5.1 IP/CIDR 规则

为每个非默认分支创建路由表和 fwmark 规则：

```bash
# 分支2（mark=41002）
ip route add default dev wm-tun2 table 41002
ip rule add fwmark 41002 lookup 41002 priority 100
```

iptables mangle 打标记：

```bash
iptables -t mangle -A PREROUTING -i wm-wg0 -d 1.0.0.0/24 \
  -j MARK --set-mark 41002 -m comment --comment "wm-branch-2"
```

### 5.2 域名规则 — DNS Proxy

Agent 内置基于 `miekg/dns` 库的 DNS Proxy：

- 监听入口节点的 WireGuard 接口地址（如 `10.210.0.1:53`）
- 仅影响 VPN 设备的 DNS 查询，不影响节点自身网络
- 转发查询到上游 DNS，拦截响应中匹配域名的 A/AAAA 记录
- 将解析到的 IP 写入 ipset（带 DNS TTL 超时）

```bash
# 创建 ipset
ipset create wm-branch-2 hash:ip timeout 0

# iptables 匹配 ipset
iptables -t mangle -A PREROUTING -i wm-wg0 \
  -m set --match-set wm-branch-2 dst \
  -j MARK --set-mark 41002 -m comment --comment "wm-branch-2-dns"
```

### 5.3 默认分支

```bash
# 默认分支路由表
ip route add default dev wm-tun1 table 41001
ip rule add fwmark 41001 lookup 41001 priority 200

# 未标记流量打默认 mark
iptables -t mangle -A PREROUTING -i wm-wg0 -m mark --mark 0 \
  -j MARK --set-mark 41001 -m comment --comment "wm-branch-default"
```

非默认分支 ip rule priority 小于默认分支（数字越小优先级越高），配合 longest-prefix-match，精确 CIDR 自动优先。

### 5.4 配置更新与清理

- Agent 根据 iptables comment 标签（`wm-branch-{id}`）做全量替换：先清除旧规则，再写入新规则
- ipset 按名称清除重建
- DNS Proxy 热更新域名规则列表（无需重启）

### 5.5 流量路径示例

```
设备(10.210.0.100) 访问 google.com:

1. DNS 查询 → 10.210.0.1:53 (Agent DNS Proxy)
2. Proxy 匹配 google.com → 转发上游 → 拿到 142.250.x.x
3. 142.250.x.x 写入 ipset wm-branch-2 (TTL=300s)
4. 返回 DNS 响应给设备
5. 设备发起 TCP 连接到 142.250.x.x
6. 包进入 wm-wg0 → iptables mangle PREROUTING
7. 匹配 ipset wm-branch-2 → MARK 41002
8. ip rule: fwmark 41002 → table 41002 → dev wm-tun2
9. 流量通过 wm-tun2 → 美国出口节点 → 互联网
```

---

## 6. 外部规则源同步（Agent 侧）

### 6.1 同步机制

Agent 内置定时器，根据配置中各 `rule_sources` 的 `sync_interval` 定期拉取外部 URL：

1. Fetch URL 内容，超时 30 秒
2. 解析内容，自动分类 IP/CIDR 和域名
3. IP/CIDR → 更新 iptables mangle 规则
4. 域名 → 更新 DNS Proxy 域名匹配列表
5. 上报同步结果给管理平台（POST `/api/agent/status`）
6. 失败时保留旧规则，上报错误

### 6.2 管理平台侧

管理平台记录外部源的元信息（URL、上次同步时间）。规则内容的实际拉取和应用由 Agent 完成。管理平台 UI 提供"立即同步"按钮，通过 SSE 通知 Agent 立即执行一次同步。

---

## 7. 配置变更通知

规则变更时需通知受影响的入口节点：

1. 规则 CRUD / 启用禁用 → 查 `branch_filters` → 找关联 branches → 找所属 line → 找入口节点
2. 通过 SSE 发送 `config_updated` 通知
3. Agent 收到后 GET `/api/agent/config` 拉取最新配置并应用

与现有节点/设备变更通知机制一致。

---

## 8. UI 变更

### 8.1 线路创建/编辑页

从线性链编排改为"入口 + 多分支"编排：

- **第一步**：选入口节点（线路级，唯一一个）
- **第二步**：管理分支（可增删多条），每条分支包含：
  - 名称
  - 可选中转节点（可多个，拖拽排序）
  - 出口节点（必选）
  - 关联分流规则（多选）
  - 是否为默认分支（radio 选择，有且仅有一条）
- 至少保留一条分支

### 8.2 分流规则创建/编辑页

在现有基础上调整：

- "关联线路"改为"关联分支"，按线路分组展示
- 新增"域名规则"textarea，与 IP/CIDR 规则并列
- 新增"外部规则源"区域：URL 输入框 + 上次同步时间 + 立即同步按钮
- 有外部源时，rules textarea 分为外部源内容（只读）和手动追加（可编辑）两个区域

### 8.3 分流规则列表页

在现有列表基础上增加列：

| 名称 | 模式 | 规则数 | 关联分支 | 状态 | 操作 |
|------|------|--------|---------|------|------|
| 中国 IP | 白名单 | 5832 条 | 3 个分支 | 已启用 | 编辑 删除 |

"规则数"合并显示 IP + 域名条数。"关联分支"显示关联的分支数量。

### 8.4 设备配置

设备仍绑定线路（不变）。设备 WireGuard 配置中 `DNS` 字段自动设为入口节点的 wg 地址（如 `10.210.0.1`），确保域名分流生效。

---

## 9. 系统设置新增项

| key | 默认值 | 说明 |
|-----|--------|------|
| `filter_sync_interval` | `86400` | 外部规则源默认同步间隔（秒），下发给 Agent |
| `dns_upstream` | `8.8.8.8,1.1.1.1` | Agent DNS Proxy 默认上游 DNS |

---

## 10. 数据迁移

### 10.1 现有线路迁移

1. 每条现有线路自动创建一条默认分支：`line_branches` 插入 `name="默认出口", is_default=true`
2. `line_nodes` 中 relay/exit 记录填充 `branch_id` 指向默认分支，entry 记录 `branch_id` 保持 null
3. `line_tunnels` 填充 `branch_id` 指向默认分支
4. `line_filters` 数据迁移到 `branch_filters`（关联到默认分支），然后删除 `line_filters` 表
5. `filters` 表新增 `domain_rules`、`source_url`、`source_updated_at` 字段，默认 null

迁移后所有现有线路行为不变。

### 10.2 Xray fwmark 调整

Xray `markCounter` 从 201 改为 42001。管理平台与 Agent 需同步更新。Agent 更新后重新拉取配置，自动清理旧 fwmark 规则并应用新值。

### 10.3 Agent 兼容

- 旧 Agent 忽略不认识的 `routing` 字段
- 新 Agent 无 `routing` 段时跳过分流逻辑
- Agent 版本号通过 status 上报，管理平台可提示升级

---

## 11. API 变更

### 11.1 分流规则 API

```
GET    /api/filters              # 规则列表（增加 rules_count、branch_count 字段）
POST   /api/filters              # 创建规则（body 增加 domain_rules、source_url、branchIds）
GET    /api/filters/:id          # 规则详情（返回关联分支信息）
PUT    /api/filters/:id          # 更新规则
DELETE /api/filters/:id          # 删除规则
PUT    /api/filters/:id/toggle   # 启用/禁用
POST   /api/filters/:id/sync     # 触发外部源立即同步（通知 Agent）
```

### 11.2 线路 API

```
POST   /api/lines                # 创建线路（body 增加 branches 数组）
PUT    /api/lines/:id            # 更新线路（含分支增删改）
GET    /api/lines/:id            # 线路详情（返回 branches 及其关联规则）
```

### 11.3 Agent API

```
GET    /api/agent/config         # 增加 routing 段
POST   /api/agent/status         # 增加规则同步状态上报
```
