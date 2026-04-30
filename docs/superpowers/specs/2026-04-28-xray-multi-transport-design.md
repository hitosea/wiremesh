# Xray 多传输并存设计 — 节点配置 / 设备选择

## 背景

当前节点的 "Xray / SOCKS5 设置" 中，「传输方式」(`xrayTransport`) 是单选枚举（`reality` 或 `ws-tls`），节点只能跑一种 Xray 入站。配置散落在 `nodes` 表的若干列与 `xrayConfig` JSON blob 里；线路级端口只在 `lines.xrayPort` / `lines.socks5Port` 上各一列；设备协议枚举为 `wireguard | xray | socks5`，不区分 Xray 的传输方式。

## 目标

让一个节点能**同时**提供 Reality 与 WebSocket+TLS 两种 Xray 入站，由设备在创建时通过 `protocol` 显式选择消费哪一种，形成"节点配置能力、设备选择消费"的闭环。

## 非目标

- **不做数据迁移**：现有 schema/字段直接清掉重建，开发期数据可丢
- **不引入设备级偏好字段**：传输选择由设备的 `protocol` 枚举值直接表达
- **不做客户端侧主备/选择器**：每个设备只对应一种传输

---

## 数据模型

### 新增表

#### `node_protocols`

存放每个节点启用的协议及其**节点级**配置（密钥、证书等）。

| 列 | 类型 | 说明 |
|---|---|---|
| `node_id` | integer FK → nodes.id | 复合主键 |
| `protocol` | text | 复合主键，枚举：`wireguard` / `xray-reality` / `xray-wstls` / `socks5` |
| `config` | text | JSON，协议特定的节点级配置（见下） |
| `created_at` | text | |
| `updated_at` | text | |

`config` 各 protocol 的内容：

- `xray-reality`: `{ realityPrivateKey: string(encrypted), realityPublicKey: string, realityShortId: string, realityDest: string, realityServerName: string }`
- `xray-wstls`: `{ wsPath: string, tlsDomain: string, certMode: "auto" | "manual", tlsCert: string | null, tlsKey: string(encrypted) | null }`
- `wireguard`: `{}`（仅作启用标记）
- `socks5`: `{}`（凭据在设备级，节点无配置）

行存在 ⇔ 该节点启用了该协议。Reality 与 WS+TLS 均按需启停，**约束：节点至少启用一种 Xray 传输**（即 `xray-reality` 与 `xray-wstls` 至少有一行存在；这是 Xray 区域作为整体功能的最小语义单元）。WireGuard / SOCKS5 行随设备绑定懒创建。

#### `line_protocols`

存放每条线路在入口节点上启用的协议及其**线路级**端口。

| 列 | 类型 | 说明 |
|---|---|---|
| `line_id` | integer FK → lines.id | 复合主键 |
| `protocol` | text | 复合主键，同上四种枚举 |
| `port` | integer NULL | 该线路入口节点上该协议的监听端口；WireGuard 永远为 NULL（共用 `wm-wg0:41820`） |
| `config` | text | JSON，线路级额外配置占位（当前所有协议为 `{}`） |
| `created_at` | text | |
| `updated_at` | text | |

行的生命周期：第一个属于该 (line, protocol) 的设备加入时**懒创建**并分配 `port`；最后一个该类型设备从该线路移除时**懒回收**整行。WireGuard 与 SOCKS5 行的创建/回收语义一致，区别仅在 WG 不分配 port。

### 移除字段

`nodes` 表删除：
`xrayProtocol`、`xrayTransport`、`xrayConfig`、`xrayWsPath`、`xrayTlsDomain`、`xrayTlsCert`、`xrayTlsKey`、`xrayPort`

`lines` 表删除：
`xrayPort`、`socks5Port`

（不做迁移，开发数据库 reset。）

### 设备协议枚举扩展

`devices.protocol` 从 `wireguard | xray | socks5` 扩展为：
`wireguard | xray-reality | xray-wstls | socks5`

`xray` 这个值不再出现在新代码里（无别名兼容）。

---

## 架构

```
节点（能力）                    线路（端口）                   设备（消费）
-------------                  -----------                   -----------
node_protocols                 line_protocols                devices.protocol
  (node, xray-reality)  ─┐      (line, xray-reality)  ─┐      "xray-reality"
  (node, xray-wstls)    ─┤      (line, xray-wstls)    ─┤      "xray-wstls"
  (node, socks5)        ─┤      (line, socks5)        ─┤      "socks5"
  (node, wireguard)     ─┘      (line, wireguard)     ─┘      "wireguard"
                                          │
                                          ▼
                              Agent: 每 (line, protocol) 一个 Xray inbound（仅 xray-*）
                                                        + SOCKS5 监听（socks5）
                                                        + WireGuard wm-wg0 共用（wireguard）
```

- 节点级配置（Reality 密钥、TLS 证书）从 `node_protocols.config` 读
- 线路级端口从 `line_protocols.port` 读
- 设备的 `protocol` 直接驱动订阅/客户端配置生成的分支

### 兼容性约束

- 设备的 `protocol` 与所绑线路的入口节点的 `node_protocols` 行必须存在对应行；否则视为不兼容
- 例：设备 `protocol = xray-wstls` 绑定 `line_id = 5`；该线路入口节点必须存在 `(node_id, "xray-wstls")` 行

---

## API 变更

### 节点 API

`POST /api/nodes` / `PUT /api/nodes/{id}` 请求体新增/调整：

```ts
{
  // 现有字段...
  protocols: {
    xrayReality?: {
      // 缺省/null = 未启用
      realityDest: string,
    },
    xrayWsTls?: {
      // 缺省/null = 未启用
      tlsDomain: string,
      certMode: "auto" | "manual",
      tlsCert?: string,
      tlsKey?: string,
    },
  },
}
```

请求体不变量：`xrayReality` 与 `xrayWsTls` 不能同时缺省/null，否则返回 `400` + `validation.xrayTransportRequired`。

行为：
- POST：按 `protocols` 写入对应 `node_protocols` 行。Reality 行写入时自动生成密钥对、Short ID 并加密保存私钥；WS+TLS 行写入时自动生成 `wsPath`。表单缺省状态（仅有 Reality）→ 仅写入 `(node_id, "xray-reality")`。
- PUT：
  - **启用某传输**（请求里某协议从无到有）→ 同 POST 的写入逻辑（Reality 生成密钥；WS+TLS 生成 `wsPath`）
  - **修改某传输配置**（行存在且请求里携带）→ 更新 `node_protocols.config`（Reality 改 dest；WS+TLS 改证书/域名）
  - **禁用某传输**（行存在但请求里显式 null）→ 两道校验：
    1. 该协议是否为节点最后一个 Xray 传输（即另一行不存在）→ 是则返回 `400` + `validation.xrayTransportRequired`
    2. 是否存在 `protocol = "xray-{transport}"` 且所绑线路入口是该节点的设备 → 有则返回 `409 CONFLICT` + `validation.xrayTransportInUse`，body 含阻塞设备/线路清单
  - 校验全通过后删 `node_protocols` 行 + 该节点作为入口的对应 `line_protocols` 行（已确认无设备依赖）

`GET /api/nodes/{id}` 响应包含：
```ts
{
  // 现有字段...
  protocols: {
    xrayReality: { realityDest, realityPublicKey, realityShortId, realityServerName, wsPath: null },
    xrayWsTls?: { tlsDomain, certMode, wsPath, hasCert: boolean },
  },
}
```
（私钥、证书私钥不下发到前端；`hasCert` 仅指示是否已上传，证书内容不返回。）

### 设备 API

`POST /api/devices` / `PUT /api/devices/{id}`：
- `protocol` 校验枚举改为 `["wireguard", "xray-reality", "xray-wstls", "socks5"]`
- 创建/绑定线路时，校验入口节点 `node_protocols` 必须有对应 `protocol` 行；不通过返回 `409` + `validation.deviceProtocolNotSupported`
- 端口分配：从 `line_protocols.port` 读；若该 (line, protocol) 行不存在则懒创建并分配端口
- 删除：检查该 (line, protocol) 是否还有其他设备，无则删 `line_protocols` 行并回收端口

### 错误码新增

| 键 | 含义 |
|---|---|
| `validation.xrayTransportInUse` | 节点禁用某 Xray 传输时存在依赖设备，body 含 `{ transport: "reality"\|"ws-tls", devices: [{id, name, lineId}] }` |
| `validation.xrayTransportRequired` | 请求会让节点 Xray 传输数为 0（双向缺失或试图删最后一个）|
| `validation.deviceProtocolNotSupported` | 设备的 protocol 不在所选线路入口节点的启用协议中 |

---

## Agent 协议变更

### `XrayConfig` 重构

`agent/api/config_types.go`：

```go
type XrayConfig struct {
    Enabled  bool             `json:"enabled"`
    Inbounds []XrayInbound    `json:"inbounds"`     // 替代原顶层的 Transport/Reality*/Tls*
    DNSProxy string           `json:"dnsProxy,omitempty"`
}

type XrayInbound struct {
    LineID    int       `json:"lineId"`
    Transport string    `json:"transport"`         // "reality" | "ws-tls"
    Port      int       `json:"port"`
    Protocol  string    `json:"protocol"`          // 当前固定 "vless"

    // Reality（transport=="reality" 时填充）
    RealityPrivateKey  string   `json:"realityPrivateKey,omitempty"`
    RealityShortId     string   `json:"realityShortId,omitempty"`
    RealityDest        string   `json:"realityDest,omitempty"`
    RealityServerNames []string `json:"realityServerNames,omitempty"`

    // WS+TLS（transport=="ws-tls" 时填充）
    WsPath    string `json:"wsPath,omitempty"`
    TlsDomain string `json:"tlsDomain,omitempty"`
    TlsCert   string `json:"tlsCert,omitempty"`
    TlsKey    string `json:"tlsKey,omitempty"`

    // 路由分支（与原 XrayLineRoute 同语义）
    UUIDs    []string         `json:"uuids"`
    Mark     int              `json:"mark"`
    Tunnel   string           `json:"tunnel"`
    Branches []XrayLineBranch `json:"branches"`
}
```

变更点：
- 取消顶层单值 `Transport` / `RealityXxx` / `TlsXxx` / `WsPath`
- 一条线路若两种传输都启用，会出现两条 `XrayInbound` 项（同 `LineID`，不同 `Transport`、不同 `Port`、`UUIDs` **不共享**——每个 inbound 仅含与其传输匹配的设备 UUID，因为设备在 `devices.protocol` 上已经绑死了一种传输）

**枚举命名注意**：`XrayInbound.Transport` 用 agent 内部命名 `"reality"` / `"ws-tls"`（与现有 agent 代码保持一致）；平台层 `devices.protocol` 用 `"xray-reality"` / `"xray-wstls"`。装配时在 `/api/agent/config` 中做一次映射。

### `agent/xray/config.go`

- 遍历 `XrayInbounds`，每条生成一个 inbound + outbound + routing rule
- 对应 `inboundTag = "in-line-{LineID}-{Transport}"` 以避免冲突
- 客户端 `flow` 字段仅 Reality 入站填 `xtls-rprx-vision`，WS+TLS 不填（与现状一致）

### Server-side 生成

`src/app/api/agent/config/route.ts` 重写 Xray 部分：
1. 查 `node_protocols WHERE node_id = ? AND protocol IN ('xray-reality','xray-wstls')`，得到节点支持的传输列表
2. 对每条该节点作为入口的线路，查 `line_protocols WHERE line_id IN (...) AND protocol IN ('xray-reality','xray-wstls')`，获得 (line, transport, port)
3. 对每个 (line, transport) 组合，查该线路上 `protocol` 与 transport 对应（`xray-reality` ↔ `reality`，`xray-wstls` ↔ `ws-tls`）的所有 `devices.xrayUuid` 作为该 inbound 的 clients
4. 装配 `XrayInbound[]`

边界：若某 (line, transport) 在 `line_protocols` 有行但当前没有对应设备 → 仍下发 inbound（无 clients 时跳过该 inbound 生成，避免空 clients 让 Xray 报错）。`line_protocols` 行存在但无设备的状态不应该出现（懒回收逻辑保证）；若出现作为容错处理。

### SOCKS5

`SocksConfig` 类似简化：
- 节点上启用 socks5（存在 `(node_id, "socks5")` 行，懒创建）
- 每条线路 `(line_id, "socks5")` 行的 `port` 即 SOCKS5 监听端口
- 用户名/密码仍来自设备表，按 line 聚合下发

---

## 订阅 / 客户端配置

`src/lib/subscription/load-device-context.ts` 重构：

- 入口节点查询同时拉 `node_protocols` 与 `line_protocols`，组装到 `DeviceContext`
- `DeviceContext.entry` 新字段：`xrayReality?: { publicKey, shortId, dest, serverName }`、`xrayWsTls?: { wsPath, tlsDomain }`，按设备 `protocol` 选其一
- 端口字段从 `line_protocols.port` 读

各 builder（`clash-builder.ts` / `singbox-builder.ts` / `uri-builders.ts` / `v2ray-builder.ts` / `shadowrocket-builder.ts`）：
- 分支条件由 `device.protocol === "xray"` + `node.xrayTransport === "ws-tls"` 改为 `device.protocol === "xray-wstls"` 等价单条件
- `formats.ts` 的 `FORMAT_PROTOCOL_SUPPORT` 改为四列：`{ wireguard, xrayReality, xrayWsTls, socks5 }`，所有格式四个均为 `true`

---

## UI 变更

### 节点新增/编辑页 — Xray 配置区域

布局改为 shadcn `Tabs`：

```
┌── Xray / SOCKS5 设置 ─────────────────────────────────┐
│ [Reality ✕] [WebSocket+TLS ✕]   [+ 添加 WebSocket+TLS] │
│ ──────────────────────────────────────────────────── │
│ <选中 tab 的配置面板>                                 │
└───────────────────────────────────────────────────────┘
```

- **Reality tab**（默认存在）：
  - Reality 目标网站（可编辑）
  - Public Key / Short ID / Server Name（仅编辑页只读展示）
- **WebSocket+TLS tab**：未启用时显示 `[+ 添加 WebSocket+TLS]` 按钮代替该 tab；点击后插入 tab 并切换至。包含：
  - TLS 域名
  - 证书管理（自动 / 手动）
  - 证书 / 私钥（手动模式）
  - WebSocket Path（编辑页只读展示）
- **删除按钮的可见性**：每个 tab header 上都显示 ✕，**仅当当前是节点上最后一个 Xray 传输时该 tab 的 ✕ 隐藏/置灰**。即：
  - 仅有 Reality（默认）→ Reality tab 不可删
  - 仅有 WS+TLS → WS+TLS tab 不可删
  - 两者都启用 → 两个都可删
- 删除某 tab 时调用 `PUT /api/nodes/{id}` 携带对应 protocol 字段为 `null`：
  - 若服务端返回 `validation.xrayTransportInUse`：弹窗展示阻塞设备列表（设备名 + 所属线路 + 跳转链接），用户必须先处理这些设备
  - 若服务端返回 `validation.xrayTransportRequired`：理论上前端已通过禁用 ✕ 防止此情况，作为兜底
- 添加 Reality（已被删除时）：在原 `[+ 添加 WebSocket+TLS]` 旁出现 `[+ 添加 Reality]`；点击插入 Reality tab，对应字段需要新生成密钥（前端只发请求，后端生成）
- 移除节点表单上的"代理起始端口"字段及相应数据库列。所有 `line_protocols.port` 分配从系统设置 `xray_default_port` 起始（已存在），不再有节点级覆盖。换入口节点不再触发端口重算。

### 设备新增/编辑页

`Select` 选项从 3 项扩到 4 项：
```
WireGuard / Xray (Reality) / Xray (WS+TLS) / SOCKS5
```

绑定线路下拉旁附说明：选中后若入口节点不支持该 protocol，显示行内警告，提交时也会被服务端拦截。

### 设备列表页

- `PROTOCOL_VARIANTS` 加两个 variant：`xray-reality` 和 `xray-wstls`
- Address 列：`xray-reality` / `xray-wstls` 都展示 `xrayUuid`（与原 `xray` 行为一致）
- Badge 文案走 i18n 新键

### 节点列表 — `node-ports-detail`

当 `node_protocols` 同时含 `xray-reality` 和 `xray-wstls` 时，按行并列显示两组（每行一种传输 + 该传输各线路端口）。

---

## i18n 新增/调整

`messages/zh-CN.json` / `en.json`：

- `nodes.xrayProtocols.title` — "传输方式" / "Transports"
- `nodes.xrayProtocols.addReality` — "添加 Reality" / "Add Reality"
- `nodes.xrayProtocols.addWsTls` — "添加 WebSocket+TLS" / "Add WebSocket+TLS"
- `nodes.xrayProtocols.removeTooltip` — "移除该传输" / "Remove this transport"
- `nodes.xrayProtocols.lastTransportTooltip` — "至少需保留一种传输方式" / "At least one transport must remain"
- `nodes.xrayProtocols.realityTabLabel` — "Reality"（不翻译）
- `nodes.xrayProtocols.wsTlsTabLabel` — "WebSocket+TLS"
- `devices.protocol.xrayReality` — "Xray (Reality)"
- `devices.protocol.xrayWsTls` — "Xray (WS+TLS)"
- `errors.validation.protocolInvalid` — "协议必须为 wireguard / xray-reality / xray-wstls / socks5" / 同步英文
- `errors.validation.xrayTransportInUse` — "节点存在依赖该传输的设备，无法移除" / 同步英文
- `errors.validation.xrayTransportRequired` — "节点至少需保留一种 Xray 传输方式" / 同步英文
- `errors.validation.deviceProtocolNotSupported` — "所选线路的入口节点未启用该协议" / 同步英文

旧键 `nodes.xrayTransport` / `xrayTransportReality` / `xrayTransportWsTls` 不再使用，删除。

---

## 校验与级联规则汇总

| 操作 | 校验 | 失败行为 |
|---|---|---|
| 节点 PUT 移除某 Xray 传输 | (a) 该节点是否会因此剩 0 种 Xray 传输；(b) 该节点作为入口的线路上是否还有 `protocol="xray-{transport}"` 的设备 | (a) 400 + `xrayTransportRequired`；(b) 409 + `xrayTransportInUse` 含阻塞清单 |
| 节点 POST | `protocols.xrayReality` 与 `protocols.xrayWsTls` 至少一项非空 | 400 + `xrayTransportRequired` |
| 设备 POST | `protocol` 必须在所选线路入口节点的 `node_protocols` 中 | 拦截 |
| 设备 PUT 改 line | 新线路入口节点必须支持该 protocol | 拦截 |
| 节点删除 | 现有逻辑（先解绑设备）依然有效 | — |

WireGuard 与 SOCKS5 的"启用/禁用"在当前设计里**不暴露 UI**——`(node, wireguard)` / `(node, socks5)` 行的存在性由设备绑定时自动管理（懒创建）。后续若要做 UI 开关，规则与 WS+TLS 对称（拦截依赖）。

---

## 测试要点

1. 建节点时仅 Reality → `node_protocols` 仅 1 行；不创建任何 `line_protocols`
2. 建节点时仅 WS+TLS → `node_protocols` 仅 1 行（无 Reality 密钥生成）
3. 建节点时两者都不传 → 400 + `xrayTransportRequired`
4. 节点编辑加 WS+TLS → 第二行写入；`wsPath` 自动生成；`tlsDomain` 必填
5. 设备 protocol = `xray-wstls` 绑定到入口节点未启用 WS+TLS 的线路 → 拒绝
6. 设备 protocol = `xray-reality` 绑定到线路 → 懒创建 `(line, xray-reality)` 行并分配端口
7. 同线路同时存在 reality/ws-tls 设备 → Agent 收到 2 条 `XrayInbound`，listening 不同端口
8. 移除节点 WS+TLS（无依赖）→ 删 `node_protocols` 行，删该节点作为入口的所有 `line_protocols where protocol="xray-wstls"`
9. 移除节点 WS+TLS（有依赖设备）→ 409 + 阻塞设备列表
10. 仅有 WS+TLS 的节点尝试移除 WS+TLS → 400 + `xrayTransportRequired`（Reality tab 也同对称）
11. 已删除 Reality 的节点重新添加 Reality → 后端生成新密钥；旧 dest（无）变默认值
12. 删除最后一个 `xray-reality` 设备 → 该 `line_protocols` 行回收，端口可被未来线路复用
13. 订阅生成（singbox / clash / v2ray / shadowrocket）：reality 设备与 ws-tls 设备各拿对应配置

---

## 实施范围（一个 plan 的尺度）

- DB migration：建表、删字段（开发期 reset）
- 节点 API + Node 添加/编辑页 + Tabs UI
- 设备 protocol 枚举扩展 + 设备 API + 设备添加/编辑/列表 UI
- `load-device-context` + 5 个 builder + `formats.ts` 改造
- Agent 协议（`XrayConfig` / `xray/config.go` 重写）
- Server 侧 `/api/agent/config` 装配重写
- i18n
- e2e 验证（手动 + agent 重启）
