# Agent 安装安全改进设计

## 背景

全面检查 Agent 安装对服务器的影响后，发现 3 个问题：

1. 开启 `ip_forward` 后，如果 FORWARD 链默认策略是 ACCEPT，可能导致服务器意外转发非 WireMesh 流量
2. 安装脚本会覆盖已有 Xray 服务的配置路径，导致原有 Xray 功能失效
3. Agent 停止/卸载后缺乏完整清理机制

## 修复方案

### 1. FORWARD 链安全警告

**位置**：安装脚本 Phase 3，开启 ip_forward 之后。

**逻辑**：
```bash
# 检查 FORWARD 链默认策略
FORWARD_POLICY=$(iptables -L FORWARD | head -1 | grep -oP '\(policy \K\w+')
if [ "$FORWARD_POLICY" = "ACCEPT" ]; then
  warn "============================================"
  warn "FORWARD chain default policy is ACCEPT"
  warn "With ip_forward enabled, this server may"
  warn "forward traffic between network interfaces."
  warn "If this is not intended, consider setting:"
  warn "  iptables -P FORWARD DROP"
  warn "============================================"
fi
```

只警告不阻断，因为 Docker 等软件正常运行需要 FORWARD ACCEPT。

### 2. Xray 服务独立命名

将 WireMesh 使用的 Xray 完全独立，不影响已有 Xray 安装。

| 项目 | 改前 | 改后 |
|------|------|------|
| 二进制路径 | `/usr/local/bin/xray` | `/usr/local/bin/wiremesh-xray` |
| 服务名 | `xray.service` | `wiremesh-xray.service` |
| 服务文件 | `/etc/systemd/system/xray.service` | `/etc/systemd/system/wiremesh-xray.service` |
| LookPath 检测 | `exec.LookPath("xray")` | `exec.LookPath("wiremesh-xray")` |
| override 逻辑 | 检测已有 → 创建 `xray.service.d/` | 删除，直接创建独立服务 |

**安装脚本变更**：
- `command -v xray` → `command -v wiremesh-xray`
- 下载 Xray 后安装到 `/usr/local/bin/wiremesh-xray`
- 直接创建 `/etc/systemd/system/wiremesh-xray.service`，ExecStart 指向 `wiremesh-xray`
- 删除所有 override 相关逻辑（不再检测 `xray.service` 是否存在）
- `systemctl enable/stop` 改为 `wiremesh-xray`

**Agent 代码变更**（`agent/xray/manager.go`）：
- `XrayService = "xray"` → `XrayService = "wiremesh-xray"`
- `exec.LookPath("xray")` → `exec.LookPath("wiremesh-xray")`

### 3. 卸载脚本

**新增 API**：`GET /api/nodes/[id]/uninstall-script`

**认证**：与安装脚本相同（session cookie 或 agentToken query param）。

**卸载脚本执行步骤**：

1. **停止并禁用服务**
   ```bash
   systemctl stop wiremesh-agent
   systemctl disable wiremesh-agent
   systemctl stop wiremesh-xray
   systemctl disable wiremesh-xray
   ```

2. **删除 WireGuard 接口**
   ```bash
   ip link set down wm-wg0
   ip link del wm-wg0
   # 删除所有 wm-tun* 接口
   for iface in $(ip -o link show | grep -oP 'wm-tun\d+'); do
     ip link set down "$iface"
     ip link del "$iface"
   done
   ```

3. **清理 iptables 规则**（所有包含 `wm-` 注释的规则）
   ```bash
   # filter FORWARD, nat POSTROUTING, mangle PREROUTING/OUTPUT
   ```

4. **清理 ip rule 和路由表**
   ```bash
   # 表 101-199, 201-299, 41001-41100, 42001-42099
   ```

5. **清理 ipset**
   ```bash
   # 删除所有 wm- 前缀的 ipset
   ```

6. **还原 sysctl**
   ```bash
   rm -f /etc/sysctl.d/99-wiremesh.conf
   sysctl -w net.ipv4.ip_forward=0
   ```
   附带警告：如果服务器有其他服务依赖 ip_forward（如 Docker），不应关闭。脚本提示用户确认。

7. **删除文件**
   ```bash
   rm -f /etc/systemd/system/wiremesh-agent.service
   rm -f /etc/systemd/system/wiremesh-xray.service
   rm -rf /etc/wiremesh/
   rm -f /usr/local/bin/wiremesh-agent
   rm -f /usr/local/bin/wiremesh-xray
   systemctl daemon-reload
   ```

8. **不删除依赖包**（wireguard、iptables、ipset），因为可能被其他软件使用。

### 4. CLAUDE.md 命名规范更新

在命名规范表中添加：

| 项目 | 命名 |
|------|------|
| Xray 二进制 | wiremesh-xray |
| Xray 服务 | wiremesh-xray.service |

## 涉及文件

| 文件 | 操作 |
|------|------|
| `agent/xray/manager.go` | 改 `XrayService` 和 `LookPath` |
| `src/app/api/nodes/[id]/script/route.ts` | 改安装脚本 |
| `src/app/api/nodes/[id]/uninstall-script/route.ts` | 新增卸载脚本 |
| `CLAUDE.md` | 更新命名规范 |
