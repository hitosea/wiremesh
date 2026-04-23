# Add-Node Xray 配置补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"添加节点"页的 Xray 配置与"编辑节点"页完全对齐：支持 `xrayTransport` 传输方式切换（reality / ws-tls），ws-tls 下支持 TLS 域名与 auto/manual 证书输入。

**Architecture:** 前端 `nodes/new/page.tsx` 新增 state 与条件渲染（复用 edit 页的所有 i18n key、组件与交互），后端 `POST /api/nodes` 扩展接收 ws-tls 字段、校验 domain、加密存储 key。Reality keypair 与 `xrayWsPath` 继续无条件生成，保留事后切换能力。

**Tech Stack:** Next.js (app router) + React hooks + Drizzle/SQLite + next-intl；无 schema / agent 协议变更。

**Spec:** `docs/superpowers/specs/2026-04-23-add-node-xray-parity-design.md`

---

### Task 1: 后端 POST 接收 ws-tls 字段 + domain 校验

**Files:**
- Modify: `src/app/api/nodes/route.ts` (`POST` handler, 目前 153-270)

- [ ] **Step 1: 在 body 解构里新增 ws-tls 字段**

把 `POST` handler 开头的解构（当前 155-163 行）替换成：

```ts
const body = await request.json();
const {
  name,
  ip,
  domain,
  port,
  xrayPort,
  externalInterface,
  remark,
  xrayTransport: rawTransport,
  xrayTlsDomain,
  xrayTlsCert,
  xrayTlsKey,
} = body;
```

- [ ] **Step 2: 规范化 transport，并在 ws-tls 时校验 domain**

紧接 `if (!name || !ip)` 校验块之后（现在落在大约 168 行），插入：

```ts
const transport = rawTransport === "ws-tls" ? "ws-tls" : "reality";

if (transport === "ws-tls") {
  if (!xrayTlsDomain || !String(xrayTlsDomain).trim()) {
    return error("VALIDATION_ERROR", "validation.wsTlsDomainRequired");
  }
}
```

- [ ] **Step 3: 把新字段写入 insert values**

把 `db.insert(nodes).values({...})` 里硬编码的 `xrayTransport: "reality"` 改为使用 `transport`，并在同一个对象里追加三个 ws-tls 字段。替换当前 232-238 行附近这段：

```ts
xrayProtocol: "vless",
xrayTransport: "reality",
xrayWsPath,
xrayPort: xrayPort ?? parseInt(settingsMap["xray_default_port"] ?? String(DEFAULT_PROXY_PORT)),
xrayConfig: resolvedXrayConfig,
externalInterface: externalInterface ?? "eth0",
remark: remark ?? null,
```

为：

```ts
xrayProtocol: "vless",
xrayTransport: transport,
xrayWsPath,
xrayTlsDomain: transport === "ws-tls" ? String(xrayTlsDomain).trim() : null,
xrayTlsCert: transport === "ws-tls" && xrayTlsCert ? xrayTlsCert : null,
xrayTlsKey:
  transport === "ws-tls" && xrayTlsKey ? encrypt(xrayTlsKey) : null,
xrayPort: xrayPort ?? parseInt(settingsMap["xray_default_port"] ?? String(DEFAULT_PROXY_PORT)),
xrayConfig: resolvedXrayConfig,
externalInterface: externalInterface ?? "eth0",
remark: remark ?? null,
```

注意：Reality keypair 继续无条件生成（现有 208-217 行不动），`xrayWsPath` 继续无条件生成（219 行不动）——两者都保留用于事后切换。

- [ ] **Step 4: TypeScript / lint 检查**

Run: `npm run lint`
Expected: 不得出现本次改动文件的新错误。`PASS` 或仅有与本次改动无关的既有告警。

- [ ] **Step 5: 回归用例 1 — reality 默认行为兼容**

假设已登录并将 session cookie 存在 `/tmp/wm_cookies.txt`、`P=http://localhost:3456`（与现有开发约定一致）。

Run:
```bash
curl -s -b /tmp/wm_cookies.txt "$P/api/nodes" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"t-reality","ip":"10.9.9.1","externalInterface":"eth0"}' \
  | python3 -m json.tool
```
Expected: `data.xrayTransport` 为 `"reality"`；`xrayConfig` JSON 字符串里含 `realityPublicKey`。

- [ ] **Step 6: 回归用例 2 — ws-tls auto（不传 cert/key）**

Run:
```bash
curl -s -b /tmp/wm_cookies.txt "$P/api/nodes" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"t-wstls-auto","ip":"10.9.9.2","externalInterface":"eth0","xrayTransport":"ws-tls","xrayTlsDomain":"vpn.example.com"}' \
  | python3 -m json.tool
```
Expected: `data.xrayTransport` 为 `"ws-tls"`。随后拉详情确认 domain 与空 cert/key：

```bash
NODE_ID=$(curl -s -b /tmp/wm_cookies.txt "$P/api/nodes?search=t-wstls-auto" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')
curl -s -b /tmp/wm_cookies.txt "$P/api/nodes/$NODE_ID" | python3 -c '
import sys,json
n=json.load(sys.stdin)["data"]
print("transport=",n["xrayTransport"])
print("tlsDomain=",n["xrayTlsDomain"])
print("tlsCert=",n["xrayTlsCert"])
print("tlsKeyDecrypted=",n["xrayTlsKey"])
'
```
Expected: `transport=ws-tls`、`tlsDomain=vpn.example.com`、`tlsCert=None`、`tlsKeyDecrypted=None`。

- [ ] **Step 7: 回归用例 3 — ws-tls manual（cert + key 被加密）**

Run:
```bash
curl -s -b /tmp/wm_cookies.txt "$P/api/nodes" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"t-wstls-manual","ip":"10.9.9.3","externalInterface":"eth0","xrayTransport":"ws-tls","xrayTlsDomain":"vpn.example.com","xrayTlsCert":"-----BEGIN CERTIFICATE-----\nMIIB...fake\n-----END CERTIFICATE-----","xrayTlsKey":"-----BEGIN PRIVATE KEY-----\nMIIE...fake\n-----END PRIVATE KEY-----"}' \
  | python3 -m json.tool
```
Expected: 返回成功。随后：

```bash
NODE_ID=$(curl -s -b /tmp/wm_cookies.txt "$P/api/nodes?search=t-wstls-manual" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')
curl -s -b /tmp/wm_cookies.txt "$P/api/nodes/$NODE_ID" | python3 -c '
import sys,json
n=json.load(sys.stdin)["data"]
print("tlsCertHead=",n["xrayTlsCert"][:27] if n["xrayTlsCert"] else None)
print("tlsKeyHead=",n["xrayTlsKey"][:27] if n["xrayTlsKey"] else None)
'
```
Expected: `tlsCertHead=-----BEGIN CERTIFICATE-----`（明文存储）、`tlsKeyHead=-----BEGIN PRIVATE KEY-----`（GET 里已解密输出）。

- [ ] **Step 8: 回归用例 4 — ws-tls 缺 domain 报错**

Run:
```bash
curl -s -b /tmp/wm_cookies.txt "$P/api/nodes" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"t-wstls-bad","ip":"10.9.9.4","externalInterface":"eth0","xrayTransport":"ws-tls"}' \
  | python3 -m json.tool
```
Expected: HTTP 400 风格响应，`error` 字段为 `"validation.wsTlsDomainRequired"`。

- [ ] **Step 9: 清理测试节点**

```bash
for n in t-reality t-wstls-auto t-wstls-manual; do
  ID=$(curl -s -b /tmp/wm_cookies.txt "$P/api/nodes?search=$n" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d[0]["id"] if d else "")')
  if [ -n "$ID" ]; then
    curl -s -b /tmp/wm_cookies.txt -X DELETE "$P/api/nodes/$ID" > /dev/null
  fi
done
```

- [ ] **Step 10: Commit**

```bash
git add src/app/api/nodes/route.ts
git commit -m "feat(nodes): accept ws-tls fields on node create"
```

---

### Task 2: 前端"添加节点"页新增 transport 选择与 ws-tls 字段

**Files:**
- Modify: `src/app/(dashboard)/nodes/new/page.tsx`

- [ ] **Step 1: 添加 Select / Textarea 组件 import**

在文件顶部既有的 shadcn UI import 旁补齐 Select 与 Textarea（Textarea 已在文件中，仅需新增 Select）。将：

```tsx
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
```

改为：

```tsx
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
```

- [ ] **Step 2: 增补 `nodes` 翻译命名空间 hook**

在已有 `useTranslations` 调用（当前 23-25 行）下补一个：

当前：

```tsx
const t = useTranslations("nodeNew");
const tc = useTranslations("common");
const te = useTranslations("errors");
```

改为：

```tsx
const t = useTranslations("nodeNew");
const tc = useTranslations("common");
const te = useTranslations("errors");
const ts = useTranslations("nodes");
```

- [ ] **Step 3: 新增 state**

在 `const [realityDest, setRealityDest] = useState(DEFAULT_REALITY_DEST);` 下面追加：

```tsx
const [xrayTransport, setXrayTransport] = useState<"reality" | "ws-tls">("reality");
const [tlsDomain, setTlsDomain] = useState("");
const [tlsCertMode, setTlsCertMode] = useState<"auto" | "manual">("auto");
const [tlsCert, setTlsCert] = useState("");
const [tlsKey, setTlsKey] = useState("");
```

- [ ] **Step 4: 扩展 submit body**

将 `handleSubmit` 里的 `body` 构造（当前 55-64 行）改为：

```tsx
const body: Record<string, unknown> = {
  name: name.trim(),
  ip: ip.trim(),
  domain: domain.trim() || null,
  port: port ? parseInt(port) : undefined,
  remark: remark.trim() || null,
  externalInterface: externalInterface.trim() || "eth0",
  xrayPort: xrayPort ? parseInt(xrayPort) : null,
  xrayTransport,
};

if (xrayTransport === "reality") {
  body.realityDest = realityDest || undefined;
} else {
  body.xrayTlsDomain = tlsDomain.trim();
  if (tlsCertMode === "manual") {
    body.xrayTlsCert = tlsCert;
    body.xrayTlsKey = tlsKey;
  }
}
```

注意：`realityDest` 仅在 reality 模式下发送。缺 `tlsDomain` 的提示由后端 `validation.wsTlsDomainRequired` 返回、`translateError` 翻译，与 edit 页一致。

- [ ] **Step 5: 重构 Xray Card 为 transport 感知的结构**

替换 JSX 中整张 "Xray 设置" 卡片（当前 168-199 行），把 Xray 起始端口保留为首项，后接 transport 选择器，再根据 transport 渲染不同字段：

```tsx
<Card>
  <CardHeader>
    <CardTitle>{t("xraySettings")}</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor="xrayPort">{t("xrayStartPort")}</Label>
      <Input
        id="xrayPort"
        type="number"
        value={xrayPort}
        onChange={(e) => setXrayPort(e.target.value)}
        placeholder={defaults.xray_default_port || "41443"}
      />
      <p className="text-xs text-muted-foreground">
        {t("xrayPortHint", xrayPortHintParams(xrayPort, defaults.xray_default_port))}
      </p>
    </div>

    <div className="space-y-2">
      <Label>{ts("xrayTransport")}</Label>
      <Select
        value={xrayTransport}
        onValueChange={(v: string) =>
          setXrayTransport(v === "ws-tls" ? "ws-tls" : "reality")
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="reality">{ts("xrayTransportReality")}</SelectItem>
          <SelectItem value="ws-tls">{ts("xrayTransportWsTls")}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {xrayTransport === "reality" && (
      <div className="space-y-2">
        <Label htmlFor="realityDest">{t("realityTarget")}</Label>
        <Input
          id="realityDest"
          value={realityDest}
          onChange={(e) => setRealityDest(e.target.value)}
          placeholder="www.microsoft.com:443"
        />
        <p className="text-xs text-muted-foreground">
          {t("realityTargetHint")}
        </p>
      </div>
    )}

    {xrayTransport === "ws-tls" && (
      <>
        <div className="space-y-2">
          <Label htmlFor="tlsDomain">{ts("tlsDomain")}</Label>
          <Input
            id="tlsDomain"
            value={tlsDomain}
            onChange={(e) => setTlsDomain(e.target.value)}
            placeholder="vpn.example.com"
          />
          <p className="text-xs text-muted-foreground">{ts("tlsDomainHint")}</p>
        </div>
        <div className="space-y-2">
          <Label>{ts("tlsCertMode")}</Label>
          <Select
            value={tlsCertMode}
            onValueChange={(v: string) =>
              setTlsCertMode(v === "manual" ? "manual" : "auto")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{ts("tlsCertModeAuto")}</SelectItem>
              <SelectItem value="manual">{ts("tlsCertModeManual")}</SelectItem>
            </SelectContent>
          </Select>
          {tlsCertMode === "auto" && (
            <p className="text-xs text-muted-foreground">{ts("tlsCertAutoHint")}</p>
          )}
        </div>
        {tlsCertMode === "manual" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="tlsCert">{ts("tlsCert")}</Label>
              <Textarea
                id="tlsCert"
                value={tlsCert}
                onChange={(e) => setTlsCert(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                rows={4}
                className="font-mono text-xs max-h-60 overflow-auto"
              />
              <p className="text-xs text-muted-foreground">{ts("tlsCertHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tlsKey">{ts("tlsKey")}</Label>
              <Textarea
                id="tlsKey"
                value={tlsKey}
                onChange={(e) => setTlsKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                rows={4}
                className="font-mono text-xs max-h-60 overflow-auto"
              />
              <p className="text-xs text-muted-foreground">{ts("tlsKeyHint")}</p>
            </div>
          </>
        )}
      </>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 6: 构建 / lint 校验**

Run: `npm run lint`
Expected: 无新错误。特别留意 `xrayTransport` 在 submit body 中作为 string 类型被接受。

Run: `npx tsc --noEmit` (若项目配置允许)
Expected: 无 TypeScript 错误。若项目未配置 `tsc --noEmit`，跳过此步。

- [ ] **Step 7: 浏览器端到端自检**

打开 `http://localhost:3456/nodes/new`（或本机实际端口），依次验证：

1. **默认 reality**：填 name + ip，不碰 Xray Card 下方的选择，提交 → 成功跳回 `/nodes`
2. **切换到 ws-tls**：Transport 选 "WebSocket + TLS"，下方应出现 TLS 域名 + 证书模式 Select；证书模式默认 auto，下方显示自动申请提示文案；不显示 cert/key textarea
3. **ws-tls + manual**：把证书模式切到 "手动上传"，显示 cert + key 两个 textarea
4. **提交 ws-tls 缺 domain**：transport 选 ws-tls、domain 留空、点提交 → toast 显示 "WebSocket + TLS 模式必须设置域名"（中文）或英文版对应文案
5. **提交 ws-tls auto 成功**：填 tlsDomain 提交 → 成功跳回 `/nodes`；进详情页确认 transport=ws-tls、tlsDomain 正确、cert/key 空
6. **提交 ws-tls manual 成功**：粘入任意 PEM 格式字符串（可用 `-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----` 占位）→ 成功；进详情页确认 transport=ws-tls、cert/key 有值

记下所有测试创建的节点 ID，下一步清理。

- [ ] **Step 8: 清理测试节点**

通过 UI 或 API 删除 Step 7 中创建的所有测试节点，避免干扰其他测试。

- [ ] **Step 9: Commit**

```bash
git add src/app/(dashboard)/nodes/new/page.tsx
git commit -m "feat(nodes/new): add xray transport selector and ws-tls fields"
```

---

## Self-Review

**Spec coverage:**
- "add 表单新增 xrayTransport Select" → Task 2 Step 5 ✓
- "ws-tls 下新增 tlsDomain + tlsCertMode + cert/key" → Task 2 Step 5 ✓
- "复用 edit 页 i18n key，不新增翻译" → 全部使用 `ts("nodes.*")` 与 `t("nodeNew.*")` 现有键，Task 2 Step 5 确认 ✓（已 grep 验证所有键存在）
- "后端 POST 接收 xrayTransport + ws-tls 字段" → Task 1 Step 1 ✓
- "ws-tls 校验 domain 必填，复用 `validation.wsTlsDomainRequired`" → Task 1 Step 2 ✓（已 grep 验证该键在 `messages/{zh-CN,en}.json` 均存在）
- "xrayTlsKey 加密入库" → Task 1 Step 3 ✓
- "Reality keypair 与 xrayWsPath 继续无条件生成" → Task 1 Step 3 结尾明示 ✓
- "无 schema / 无 i18n key / 无 agent 协议变更" → 计划中无任何这三类改动 ✓
- Spec 测试计划 1-5 → Task 1 Step 5-8 + Task 2 Step 7 ✓

**Placeholder scan:** 无 TBD / TODO / "add appropriate error handling" / "similar to task N" 等占位。所有代码块完整。

**Type consistency:**
- `xrayTransport` 前端 state 类型 `"reality" | "ws-tls"`，后端解构为 `rawTransport`，规范化后传 `transport`（string）——一致
- `tlsCertMode` 前端 `"auto" | "manual"`，仅前端消费，后端靠是否发送 cert/key 判断
- 所有 Select 的 `onValueChange` 签名为 `(v: string) => void`，并在回调里做枚举收窄（`v === "ws-tls" ? ... : ...`），不依赖 shadcn 的泛型
- 后端字段名与 schema 一致：`xrayTransport`、`xrayTlsDomain`、`xrayTlsCert`、`xrayTlsKey`

---

## Plan complete
