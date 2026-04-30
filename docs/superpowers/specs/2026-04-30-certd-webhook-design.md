# Certd Webhook 接入设计

**日期：** 2026-04-30
**状态：** 草稿

## 目标

用外部 [certd](https://github.com/certd/certd) 替代 Agent 内置的 HTTP-01 ACME 流程。WireMesh 暴露一个 webhook 端点，certd 的 `WebhookDeployCert` 插件在证书续签后 POST 过来；WireMesh 找出当前所有使用 `ws-tls` 且域名匹配的节点，把证书写入它们的 `xray_tls_cert` / `xray_tls_key` —— 按现有语义这等同于"切换到手动模式"，Agent 端 `needsAutocert` 判断到 `xray_tls_cert` 非空就不会再跑 ACME，因此 Agent 不需要任何改动。

## 为什么用 webhook 而不是继续 Agent 端 ACME

- `agent/xray/acme.go` 现在要求每个入口节点空出 80 端口跑 HTTP-01 challenge，跟反向代理冲突，多暴露一个对外服务，也无法签泛域名证书。
- certd 集中管理签发/续签，且支持 DNS-01 → 泛域名免费送，节点也不用再开 80 端口。
- 现有 schema 已经够用：`xray_tls_cert` 为空 → Agent 跑 ACME；非空 → Agent 当作管理员手动提供。webhook 推送进来本质上跟"管理员在 UI 粘贴证书"是同一个写操作。

## 影响范围

- 新增 API 路由：`src/app/api/webhooks/certd/route.ts`
- 新增辅助模块：`src/lib/certd-webhook.ts`（域名匹配 + 节点更新 + SSE 通知）
- 使用指南：`docs/admin-guide.zh-CN.md` 和 `docs/admin-guide.en.md` 各加一节"接入 certd 自动续签证书"，说明环境变量、URL、certd 任务里要填的 Method / Content-Type / Headers / Body 模板
- 无设置页改动，无 `messages/*.json` 改动（管理员只看 `/help`，不需要新增 UI 翻译 key）
- 无 DB migration，无 Agent 端改动

## API: POST /api/webhooks/certd

**鉴权：** `Authorization: Bearer <secret>`。secret 通过环境变量 `CERTD_WEBHOOK_SECRET` 注入（部署时由运维写入 `.env` 或 systemd unit / docker env，跟 `AUTH_SECRET` 等其它 secret 同处管理）。轮换 = 改环境变量后重启进程，并同步更新 certd 任务里的 Header。

- 进程启动时若 `CERTD_WEBHOOK_SECRET` 未设置或为空字符串：端点返回 503 + `{ error: { code: "CERTD_WEBHOOK_DISABLED" } }`，确保未配置时不会有"无密码可用"的窗口
- 比较时用 constant-time（避免 timing 泄露 secret 长度/前缀）

**请求体（JSON）：**

```json
{
  "domain": "example.com",
  "crt": "-----BEGIN CERTIFICATE-----\n...",
  "key": "-----BEGIN PRIVATE KEY-----\n..."
}
```

字段名跟 certd 默认模板（`${domain}`、`${crt}`、`${key}`）保持一致，管理员粘贴 certd 默认 body 模板即可，不用改一个字。

**校验：**
- 三个字段都必填、非空字符串
- `crt` 必须包含 `-----BEGIN CERTIFICATE-----`，且能 PEM 解析
- `key` 必须包含 `-----BEGIN ` … `PRIVATE KEY-----`，且能 PEM 解析
- 不合法时返回 400 + 翻译 key `certd.invalidPayload`

**核心逻辑：**

```
SELECT id FROM nodes
 WHERE xray_transport = 'ws-tls'
   AND xray_tls_domain = :domain

对每一条命中:
  UPDATE nodes
     SET xray_tls_cert = :crt,
         xray_tls_key  = encrypt(:key),
         updated_at    = datetime('now')
   WHERE id = :id

  sseManager.notifyNodeConfigUpdate(id)
```

多节点同域名时全量更新 —— mesh 部署里多个入口节点共用一个域名是合理场景。

**幂等性：** 如果 `xray_tls_cert` 已经等于 `:crt`，跳过 UPDATE 和 SSE 通知；`matched` 仍计入该行（让 certd 重复投递时拿到稳定的成功响应），`updated` 反映实际写入数。

**响应：**

```json
{ "data": { "domain": "example.com", "matched": 2, "updated": 2 } }
```

- 鉴权通过 + payload 合法时永远返回 200，即使 `matched = 0` 也是 200。这里返回 404 会让 certd 把"当前没有节点使用这个域名"误判为部署失败 —— 但其实证书仍然由 certd 自己保存着，状态是一致的。
- 401 仅在缺失或错误 Bearer token 时返回
- 400 仅在 payload 不合法时返回

## 使用指南改动

在 `docs/admin-guide.zh-CN.md` 和 `docs/admin-guide.en.md` 各加一节，标题如"接入 certd 自动续签证书 / Integrating certd for cert auto-renewal"。章节内容覆盖：

1. **环境变量配置**：在部署 WireMesh 的环境里设置 `CERTD_WEBHOOK_SECRET=<32 字节随机串>`，给一个生成命令示例：`openssl rand -base64 32`。说明轮换流程（改 env → 重启 → 更新 certd Header）。
2. **certd 任务配置**（`WebhookDeployCert` 插件）：
   - URL：`https://<your-wiremesh-host>/api/webhooks/certd`
   - Method：`POST`
   - Content-Type：`application/json`
   - Headers：
     ```
     Authorization=Bearer <CERTD_WEBHOOK_SECRET>
     ```
   - Body 模板：
     ```json
     {"domain":"${domain}","crt":"${crt}","key":"${key}"}
     ```
   - 成功判定（可选）：`"matched"`
3. **行为说明**：推送后 WireMesh 会自动找出所有使用 `ws-tls` 且域名匹配的节点，在一个事务里写入证书后再通知 Agent 重载。如果当前没有节点用这个域名，端点仍返回 200 + `matched: 0`，不视为部署失败。
4. **常见返回**：401 / 400 / 503 各自的含义。

## 为什么不引入 `xray_tls_source` 字段

`xray_tls_cert IS NULL OR ''` 已经编码了"自动"；非空已经编码了"手动"。再加第三种状态（`certd`）只在 UI 想区分"管理员粘贴" vs "certd 推送"时才有意义，但运维行为完全一致 —— Agent 从 DB 读证书、写文件、reload xray。日后如果 UI 真要加个标识徽章，可以从"是否设置了 webhook secret + 最近一次推送时间"这两个旁路信号推导，不需要新字段。

## 验收

- 单元测试：payload 校验（字段缺失、PEM 不合法、Bearer token 错、`CERTD_WEBHOOK_SECRET` 未配置时 503）
- 单元测试：匹配逻辑 —— 域名匹配但 `xray_transport != 'ws-tls'` **不**更新；transport+domain 都匹配 **要**更新；重复 POST 幂等
- 手动验证：在 certd 配置一个 `WebhookDeployCert` 任务指向新 URL，触发续签，确认
  1. 节点行的 `xray_tls_cert` / `xray_tls_key` 已更新
  2. SSE 事件已下发
  3. Agent 拉到新配置，`/etc/wiremesh/xray/<domain>.crt` 已被覆盖
  4. xray reload 成功
- 手动验证：推送之后 Agent 端 `needsAutocert` 返回 false（下次 reconcile 不再起 80 端口监听）
