# Add-Node Xray 配置补齐（与编辑页对齐）

## 背景

"添加节点"页 (`src/app/(dashboard)/nodes/new/page.tsx`) 的 Xray 设置卡片只有两个字段：Xray 起始端口、Reality 目标。编辑节点页 (`src/app/(dashboard)/nodes/[id]/page.tsx`) 则额外支持 `xrayTransport` 切换与 ws-tls 的 TLS 域名/证书输入。

后果：用户想从一开始使用 ws-tls，必须先以 reality 创建再进入详情页切换。而创建时被无条件生成的 Reality keypair 在 ws-tls 场景下是闲置的。

## 目标

让 add 表单的 Xray 配置项与 edit 页完全对齐，同时保持后端 POST 接口的向后兼容。

## 非目标

- 不改变 ws-tls auto 证书的获取机制（agent ACME HTTP-01 链路保持原样）
- 不对手动粘贴的 PEM 做格式校验（edit 页未校验，保持一致）
- 不修复 `PUT /api/nodes/[id]` 里给老节点补 Reality keys 时将 `xrayTransport` 误写为 `"tcp"` 的疑似瑕疵（见附录 A）

## ws-tls auto 证书链路备忘

调查结论：auto 模式对创建时序无额外要求。

1. 管理员选 auto → 只存 `xrayTransport="ws-tls"` + `xrayTlsDomain`，cert/key 为 null
2. Config dispatch (`src/app/api/agent/config/route.ts:295`) 原样下发空 cert/key
3. Agent 检测 `needsAutocert` (`agent/xray/acme.go:18`) 触发 ACME HTTP-01
4. Agent 通过 `POST /api/agent/cert` 回传，平台加密落库

add 与 create-then-edit 两种路径的 agent 时序完全相同，因此 add 表单支持 auto 模式不需要任何额外编排逻辑。前置条件（DNS、80 端口）仍是 agent 安装后的事情，现有文案已覆盖。

## 设计

### 前端改动 — `src/app/(dashboard)/nodes/new/page.tsx`

**新增 state：**

```
xrayTransport: "reality" | "ws-tls"        // 默认 "reality"
tlsDomain: string                           // ""
tlsCertMode: "auto" | "manual"              // "auto"
tlsCert: string                             // ""
tlsKey: string                              // ""
```

**Xray 设置卡片结构（Xray 起始端口保留为第一项，其余按 transport 分支）：**

```
[Xray 起始端口]                              // 保留
[Xray 传输方式 Select: reality / ws-tls]     // 新增

if (reality):
  [Reality 目标 Input]                       // 保留

if (ws-tls):
  [TLS 域名 Input]                           // 新增，必填
  [证书模式 Select: auto / manual]           // 新增
  if (manual):
    [TLS 证书 Textarea]                      // 新增
    [TLS 私钥 Textarea]                      // 新增
```

**复用 edit 页同样的 i18n key**（`nodeNew` / `nodes` 命名空间），不新增翻译项。具体：
- `ts("xrayTransport")`, `ts("xrayTransportReality")`, `ts("xrayTransportWsTls")`
- `ts("tlsDomain")`, `ts("tlsDomainHint")`
- `ts("tlsCertMode")`, `ts("tlsCertModeAuto")`, `ts("tlsCertModeManual")`, `ts("tlsCertAutoHint")`
- `ts("tlsCert")`, `ts("tlsCertHint")`, `ts("tlsKey")`, `ts("tlsKeyHint")`

**客户端提交校验：**

- `name` / `ip` 非空（现有）
- `xrayTransport === "ws-tls"` 时 `tlsDomain.trim()` 非空，否则 `toast.error(tn("wsTlsDomainRequired"))`（新增 i18n key）——或者统一由后端返回 `validation.wsTlsDomainRequired` 让前端翻译，避免新增前端提示。选后者以保持和 edit 页行为一致。

**提交 body 构造（保留现有字段，新增部分）：**

```ts
body.xrayTransport = xrayTransport;
if (xrayTransport === "ws-tls") {
  body.xrayTlsDomain = tlsDomain.trim();
  if (tlsCertMode === "manual") {
    body.xrayTlsCert = tlsCert;
    body.xrayTlsKey = tlsKey;
  }
  // reality 字段保持现状一起发送：后端会继续生成 Reality keypair 以支持事后切换
}
```

reality 模式下现有 `realityDest` 字段继续发送，保持不变。

### 后端改动 — `src/app/api/nodes/route.ts` POST

**解构新增字段：**

```ts
const {
  name, ip, domain, port, xrayPort, externalInterface, remark,
  xrayTransport, xrayTlsDomain, xrayTlsCert, xrayTlsKey,   // 新增
} = body;
```

**流程调整（替换现有 `xrayTransport: "reality"` 硬编码）：**

```ts
const transport = xrayTransport === "ws-tls" ? "ws-tls" : "reality";

if (transport === "ws-tls") {
  if (!xrayTlsDomain || !xrayTlsDomain.trim()) {
    return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
  }
}
```

**插入 values 的新字段：**

```ts
xrayTransport: transport,
xrayTlsDomain: transport === "ws-tls" ? xrayTlsDomain.trim() : null,
xrayTlsCert: transport === "ws-tls" && xrayTlsCert ? xrayTlsCert : null,
xrayTlsKey:  transport === "ws-tls" && xrayTlsKey  ? encrypt(xrayTlsKey) : null,
```

**保留不变：**

- Reality keypair 始终生成并写入 `xrayConfig`（与 PUT 行为一致，方便事后切回 reality）
- `xrayWsPath` 始终随机生成

### 数据与协议

- 无 schema 变更。涉及字段早已存在于 `nodes` 表。
- 无新 i18n key：复用 `validation.wsTlsDomainRequired`（edit 页已使用）、`nodes.*` 下现有 TLS 相关键、`nodeNew.*` 下现有 Xray 键。
- 无 agent 协议变更：下发配置走既有 `config dispatch` 路径，auto 证书流程保持原样。

### 向后兼容

- 不发送 `xrayTransport` / ws-tls 字段的调用方仍然生效：`transport` 默认取 reality，ws-tls 相关字段全部写 null，行为与当前一致。

## 测试计划

**手工（验证即可，无需新自动化测试）：**

1. Reality 路径：不选 transport（默认）创建 → 节点落库 `xrayTransport="reality"`，Reality keys 已生成
2. ws-tls + auto：选 ws-tls，填域名，证书模式保持 auto → 落库 transport=ws-tls、domain 正确、cert/key 为 null
3. ws-tls + manual：选 ws-tls，填域名，粘贴 cert + key → 落库 cert 原文、key 加密
4. ws-tls 缺域名：选 ws-tls 留空域名提交 → 返回 `validation.wsTlsDomainRequired`，前端展示翻译后的错误
5. 创建后进入 edit 页 → 所有字段回填正确、可正常编辑

## 附录 A：PUT handler 里未修的小瑕疵

`src/app/api/nodes/[id]/route.ts:147` 在给缺少 Reality keys 的老节点自动补时，无条件将 `updateData.xrayTransport = "tcp"`。同一 handler 后文 (158-161) 若 body 带 `xrayTransport` 会再次覆盖，所以 edit 页场景下不触发 bug。但当调用方不传 `xrayTransport` 而恰好节点缺 Reality keys 时，会被强制改成 `"tcp"`（这个值不是有效的 transport 枚举）。本次不处理，记为单独问题。
