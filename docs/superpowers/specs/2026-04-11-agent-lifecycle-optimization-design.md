# Agent 生命周期优化设计

## 概述

优化 WireMesh 节点 Agent 的安装、升级、卸载全流程，解决当前存在的关键缺陷（节点删除后 Agent 成孤儿、无版本管理、无自动升级），提升整体运维体验。

## 背景

当前痛点：
- 删除节点时仅删数据库记录，Agent 继续运行，内核态资源残留
- Agent 无版本号，无法判断是否需要升级
- 升级需手动到每台节点重跑安装脚本
- 二进制下载无 checksum 校验
- 安装后无健康检查
- Xray 安装后永远不更新

## 模块一：Agent 版本管理

### 编译时注入版本号

- 通过 `go build -ldflags "-X main.Version=..."` 注入版本
- 版本格式：语义化版本 `v1.0.0`，由 Dockerfile 的 build arg `AGENT_VERSION` 传入
- Agent 启动时打印版本日志

### 数据库变更

`nodes` 表新增字段：
- `agentVersion TEXT` — Agent 版本号
- `xrayVersion TEXT` — Xray 版本号

### API 变更

**`POST /api/agent/status`** — 请求体增加字段：
```json
{
  "agent_version": "v1.0.0",
  "xray_version": "v26.3.27",
  "xray_running": true
}
```

收到上报后更新 `nodes` 表的 `agentVersion`、`xrayVersion` 字段。

**`GET /api/agent/binary`** — 响应头增加：
- `X-Agent-Version: v1.0.0`
- `X-Agent-Checksum: sha256:abcdef...`

支持 HEAD 请求，Agent 可以只获取版本号和 checksum 而不下载文件。

**`GET /api/agent/xray`** — 同上，响应头增加 `X-Xray-Version` 和 `X-Xray-Checksum`。

### 二进制校验

- 构建时生成 SHA256 checksum，保存在 `/public/agent/` 目录（如 `wiremesh-agent-linux-amd64.tar.gz.sha256`）
- 安装脚本和 Agent 升级时下载后校验，不匹配则丢弃

### UI 变更

- 节点列表新增 Agent 版本列和 Xray 版本列
- 版本落后于管理平台内置最新版本时，显示"可升级"标识

## 模块二：节点删除通知与远程卸载

### SSE 新增事件

**`node_delete`** — 管理平台删除节点时发送。

### 删除流程

删除节点 = 远程卸载 + 删除记录，一步完成：

**节点在线时：**
1. 管理平台将节点标记为 `pendingDelete: true`
2. 通过 SSE 发送 `node_delete` 事件
3. Agent 收到后从管理平台下载卸载脚本（`GET /api/uninstall-script`）
4. Agent 保存到临时文件，以 `bash` 执行
5. 卸载脚本停止 Agent 服务，清理所有资源
6. 管理平台检测到节点 SSE 断开且标记为 `pendingDelete`，延迟 30 秒后删除数据库记录

注意：不能先删数据库记录再发 SSE，否则 Agent 下载卸载脚本时 token 可能已失效。

**节点离线时：**
1. 管理平台将节点标记为 `pendingDelete: true`（`nodes` 表新增 `pendingDelete INTEGER DEFAULT 0`）
2. UI 提示"节点离线，将在下次上线时自动卸载"，同时显示手动卸载命令
3. Agent 重连后执行 `pullAndApplyConfig`，config 响应中包含 `pending_delete: true` 字段，Agent 检测到后触发卸载流程（无需 SSE 连接 hook）
4. 管理平台检测到节点 SSE 断开且 `pendingDelete=true`，延迟 30 秒后删除数据库记录
5. 对于永远不上线的节点：Worker 定时任务扫描 `pendingDelete=true` 且超过 7 天的记录，直接删除

### Agent 侧实现

Agent 收到 `node_delete` 事件（或拉取配置发现 `pending_delete: true`）后：
1. `GET /api/uninstall-script` 下载卸载脚本
2. 写入 `/tmp/wiremesh-uninstall.sh`
3. 通过 `systemd-run --scope` 在独立的 systemd scope 中启动脚本，确保脚本不在 Agent 的 cgroup 内
4. Agent 不做任何特殊处理，继续正常运行
5. 卸载脚本先 `systemctl disable wiremesh-agent`（防止重启），再 `systemctl stop wiremesh-agent 2>/dev/null || true`（发送 SIGTERM）
6. `systemctl stop` 阻塞直到 Agent 完全退出——Agent 收到 SIGTERM 后正常走 `shutdown()` 清理内核资源
7. Agent 进程退出后，`systemctl stop` 返回，脚本继续执行后续清理（删文件、删服务等）
8. 双重清理（Agent shutdown + 脚本）是幂等的，不会出错

关键实现细节：
- **必须使用 `systemd-run --scope`**，不能用 `nohup` 或 `setsid`。因为 systemd 的 `KillMode=control-group`（默认值）会在 `systemctl stop` 时杀死 cgroup 中的所有进程，包括 nohup 启动的子进程。`systemd-run --scope` 让脚本运行在独立的 systemd scope 中，不受 Agent cgroup 影响。
- **`systemctl stop` 必须加 `2>/dev/null || true`**，因为卸载脚本头部有 `set -e`，如果 stop 返回非零退出码（Agent 已被 shutdown 信号停止），脚本会中断。
- 卸载脚本 `disable` 在 `stop` 之前，确保 Agent 被停止后 systemd 不会因 `Restart=always` 重启它。

### UI 变更

- 删除节点确认对话框提示"将远程卸载该节点上的所有 WireMesh 组件"
- 节点离线时额外提示"节点当前离线，将在下次上线时自动卸载"，并显示手动卸载命令

## 模块三：Agent 自动升级

### 触发方式

管理员在 UI 上手动触发，通过 SSE 推送到节点。

### SSE 新增事件

**`upgrade`** — 携带 `version` 字段，通知 Agent 升级自身。
**`xray_upgrade`** — 通知 Agent 升级 Xray。

### Agent 升级执行步骤

1. 通过 `POST /api/agent/status` 上报状态为 `upgrading`，管理平台将节点状态设为"升级中"
2. HEAD 请求 `/api/agent/binary` 获取最新版本号（`X-Agent-Version`）和 checksum（`X-Agent-Checksum`）
3. 对比本地版本号，相同则跳过，恢复状态为 `online`
4. 下载新二进制到 `/tmp/wiremesh-agent-new.tar.gz`
5. 校验 SHA256，不匹配则放弃，通过 `POST /api/agent/error` 上报错误，恢复状态为 `online`
6. 备份当前二进制：`/usr/local/bin/wiremesh-agent` → `/usr/local/bin/wiremesh-agent.backup`
7. 先 `os.Remove` 删除旧二进制（Linux 允许删除正在运行的文件，inode 保持到进程退出），再写入新二进制。不能直接覆盖，否则会报 `text file busy` 错误
8. Agent 调用 `a.Stop()` 触发正常 shutdown 流程（清理内核资源）→ 进程退出
9. 如果升级失败，Agent 上报一次正常状态（`reportStatus()`）将服务端节点状态从 `upgrading` 恢复为 `online`
10. systemd（`Restart=always`）自动拉起新版本，新版本启动后重新 `pullAndApplyConfig` 恢复所有状态，上报新版本号

注意：不能用 `systemctl restart wiremesh-agent`，因为 Agent 进程就是调用者。正确做法是 Agent 调用 `a.Stop()` 优雅退出，让 systemd 负责重启。

### Xray 升级步骤

同上逻辑，使用 `/api/agent/xray` 端点，备份为 `/usr/local/bin/wiremesh-xray.backup`，重启 `wiremesh-xray` 服务。Xray 升级不需要重启 Agent，直接 `systemctl restart wiremesh-xray` 即可（Xray 是独立服务进程）。

### Xray 版本获取

Agent 通过执行 `wiremesh-xray version` 并解析输出获取版本号。如果 Xray 未安装则上报空值。

### 回滚

- 升级前备份的 `.backup` 文件保留在磁盘上
- 新版本启动失败时（节点显示离线），管理员可 SSH 手动恢复：
  ```bash
  mv /usr/local/bin/wiremesh-agent.backup /usr/local/bin/wiremesh-agent
  systemctl restart wiremesh-agent
  ```
- 下次成功升级后 `.backup` 文件被新的备份覆盖

### 升级触发 API

**`POST /api/nodes/[id]/upgrade`** — 触发单个节点升级，通过 SSE 发送 `upgrade` 事件。
**`POST /api/nodes/[id]/xray-upgrade`** — 触发单个节点 Xray 升级。
**`POST /api/nodes/batch-upgrade`** — 批量升级，请求体 `{ nodeIds: number[], type: "agent" | "xray" }`，分批发送 SSE 事件（每批最多 5 个，间隔 3 秒）。

### 升级状态

`nodes` 表的 `status` 字段新增可选值 `upgrading`。Agent 开始升级前上报该状态，管理平台据此在 UI 上展示"升级中"，区分于普通的"离线"状态。Agent 升级完成后重新上线时恢复为 `online`。

### UI 变更

- 节点列表提供"升级"按钮（单个节点）和"全部升级"按钮（批量）
- 版本落后的节点高亮提示"可升级"
- 升级过程中节点状态显示"升级中"

## 模块四：安装脚本增强

### 安装后健康检查

脚本启动 Agent 服务后，轮询检查（最多 30 秒，每 3 秒一次）：
1. `systemctl is-active wiremesh-agent` 确认进程存活
2. 连续存活 3 次（9 秒）视为健康（排除启动后立即崩溃的情况）
3. 检查失败时输出诊断信息：`journalctl -u wiremesh-agent --no-pager -n 20`

注意：Agent 连接管理平台的确认由 Agent 自身完成（调用 `POST /api/agent/installed`），安装脚本无需也无法调用该接口（需要 Bearer token）。

### 下载失败重试

- Agent 和 Xray 二进制下载增加重试逻辑，最多 3 次，间隔 5 秒
- 每次下载后校验 SHA256 checksum

### 升级模式改进

- 检测到已有安装时，备份当前二进制为 `.backup`
- 升级失败时提示可用 `.backup` 恢复

### 幂等性加固

- Xray 安装改为：已存在时检查版本，版本落后时也更新（当前逻辑是存在就跳过）
- WireGuard 接口创建失败时给出明确错误，而不是静默继续

### 安装日志

- 脚本输出同时写入 `/var/log/wiremesh-install.log`
- 使用 `exec > >(tee -a /var/log/wiremesh-install.log) 2>&1`

## 模块五：卸载脚本改进

### 服务停止顺序调整

卸载脚本中 `systemctl disable` 移到 `systemctl stop` 之前，确保 Agent 被停止后 systemd 不会因 `Restart=always` 重启它。

### iptables 批量清理

用 `iptables-save | grep -v wm- | iptables-restore` 替代逐条循环删除，大幅提升速度。对 nat 和 mangle 表同理。所有 WireMesh 相关规则都包含 `wm-` 前缀（接口名或注释），不会误删其他规则。

### 卸载日志

- 输出写入 `/var/log/wiremesh-uninstall.log`
- 卸载完成后清理所有 wiremesh 日志文件
- 支持 `--keep-logs` 参数保留日志用于排查

### 离线节点 pendingDelete

- `nodes` 表 `pendingDelete` 字段
- Agent 重连后拉取配置，config 响应中包含 `pending_delete: true`，Agent 触发卸载
- 管理平台检测到 SSE 断开且 `pendingDelete=true`，延迟 30 秒后删除记录
- Worker 定时任务清理 `pendingDelete=true` 超过 7 天的记录（节点永远不上线的兜底）

## 存量节点兼容性

已部署的老版本 Agent 不支持新 SSE 事件（`node_delete`、`upgrade`、`xray_upgrade`），也不上报版本信息。具体影响：

- **老 Agent 收到未知 SSE 事件**：当前 `handleSSEEvent` 的 switch/case 无匹配分支时直接忽略，不会报错。安全。
- **老 Agent 不上报 `agent_version`**：管理平台收到无版本字段的状态上报时，`agentVersion` 保持为 NULL。UI 显示为"未知"。
- **第一次升级必须手动**：管理员需要在每台节点上重新运行安装脚本，将 Agent 升级到支持自动升级的版本。之后所有升级可通过管理平台远程触发。
- **老 Agent 无法远程卸载**：不支持 `node_delete` 事件，删除节点后需手动到节点上执行卸载脚本。

所有新功能对服务端是向后兼容的：新字段可选，老 Agent 不发也不影响。

## 变更汇总

### 数据库变更

`nodes` 表新增字段：
| 字段 | 类型 | 说明 |
|------|------|------|
| `agentVersion` | TEXT | Agent 版本号 |
| `xrayVersion` | TEXT | Xray 版本号 |
| `pendingDelete` | INTEGER DEFAULT 0 | 待删除标记 |

### SSE 事件新增

| 事件 | 数据 | 说明 |
|------|------|------|
| `node_delete` | `{}` | 通知 Agent 执行卸载脚本 |
| `upgrade` | `{ version: string }` | 通知 Agent 升级自身 |
| `xray_upgrade` | `{ version: string }` | 通知 Agent 升级 Xray |

### API 变更

| 端点 | 变更 |
|------|------|
| `POST /api/agent/status` | 请求体增加 `agent_version`、`xray_version`、`xray_running` |
| `GET /api/agent/binary` | 响应头增加 `X-Agent-Version`、`X-Agent-Checksum`，支持 HEAD |
| `GET /api/agent/xray` | 响应头增加 `X-Xray-Version`、`X-Xray-Checksum`，支持 HEAD |
| `GET /api/agent/config` | 响应体增加 `pending_delete` 字段（用于离线节点重连后触发卸载） |
| `DELETE /api/nodes/[id]` | 在线时先发 SSE `node_delete`，离线时标记 `pendingDelete` |
| `POST /api/nodes/[id]/upgrade` | 新增，触发单个节点 Agent 升级 |
| `POST /api/nodes/[id]/xray-upgrade` | 新增，触发单个节点 Xray 升级 |
| `POST /api/nodes/batch-upgrade` | 新增，批量升级（分批 SSE 推送） |

### Agent 代码变更

| 模块 | 变更 |
|------|------|
| `main.go` | 新增 `Version` 变量，启动时打印 |
| `agent.go` | 状态上报携带版本信息 |
| `api/sse.go` | 处理 `node_delete`、`upgrade`、`xray_upgrade` 事件 |
| 新增 `lifecycle/` | 升级和卸载执行逻辑 |

### 构建变更

| 文件 | 变更 |
|------|------|
| `Dockerfile` | Agent 构建增加 `ARG AGENT_VERSION`，使用 `-ldflags` 注入版本号，构建后生成 `.sha256` checksum 文件 |

### UI 变更

| 页面 | 变更 |
|------|------|
| 节点列表 | 新增 Agent 版本列、Xray 版本列、"可升级"标识 |
| 节点列表 | 新增"升级"按钮（单个）、"全部升级"按钮 |
| 节点删除 | 确认对话框提示远程卸载，离线时显示手动命令 |
