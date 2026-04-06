import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { error } from "@/lib/api-response";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  if (isNaN(nodeId)) return error("VALIDATION_ERROR", "无效的节点 ID");

  const node = db
    .select()
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .get();

  if (!node) return error("NOT_FOUND", "节点不存在");

  let wgPrivateKey: string;
  try {
    wgPrivateKey = decrypt(node.wgPrivateKey);
  } catch {
    return error("INTERNAL_ERROR", "解密私钥失败");
  }

  const serverUrl = request.nextUrl.origin;
  const xrayEnabled = node.xrayEnabled;

  const script = `#!/bin/bash
set -e

echo "=== WireMesh Agent 安装脚本 ==="
echo "节点: ${node.name} (ID: ${node.id})"
echo ""

# 1. 创建配置目录
mkdir -p /etc/wiremesh/wireguard

# 2. 安装 WireGuard
echo "[1/6] 安装 WireGuard..."
apt-get update -qq
apt-get install -y wireguard wireguard-tools

# 3. 写入 wm-wg0.conf
echo "[2/6] 写入 WireGuard 配置..."
cat > /etc/wiremesh/wireguard/wm-wg0.conf << 'WGEOF'
[Interface]
PrivateKey = ${wgPrivateKey}
Address = ${node.wgAddress}/24
ListenPort = ${node.port}
WGEOF

chmod 600 /etc/wiremesh/wireguard/wm-wg0.conf

# 4. 开启 IP 转发
echo "[3/6] 启用 IP 转发..."
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p

# 5. 启动 wm-wg0 接口
echo "[4/6] 启动 WireGuard 接口..."
ip link add dev wm-wg0 type wireguard 2>/dev/null || true
wg setconf wm-wg0 /etc/wiremesh/wireguard/wm-wg0.conf
ip addr add ${node.wgAddress}/24 dev wm-wg0 2>/dev/null || true
ip link set up dev wm-wg0
${xrayEnabled ? `
# 6. 安装 Xray
echo "[5/6] 安装 Xray..."
bash <(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh) @ latest
` : "# 跳过 Xray 安装（未启用）"}

# 7. 下载 Agent 二进制
echo "[${xrayEnabled ? "6" : "5"}/6] 下载 wiremesh-agent..."
curl -fsSL "${serverUrl}/api/agent/binary" -o /usr/local/bin/wiremesh-agent
chmod +x /usr/local/bin/wiremesh-agent

# 8. 写入 agent.yaml
cat > /etc/wiremesh/agent.yaml << 'AGENTEOF'
server_url: ${serverUrl}
node_id: ${node.id}
token: ${node.agentToken}
report_interval: 30
AGENTEOF

chmod 600 /etc/wiremesh/agent.yaml

# 9. 创建 systemd 服务
cat > /etc/systemd/system/wiremesh-agent.service << 'SVCEOF'
[Unit]
Description=WireMesh Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/wiremesh-agent --config /etc/wiremesh/agent.yaml
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
SVCEOF

# 10. 启动 Agent
systemctl daemon-reload
systemctl enable wiremesh-agent
systemctl start wiremesh-agent

echo ""
echo "=== 安装完成 ==="
echo "节点 ${node.name} 已成功安装并启动 WireMesh Agent"
echo "Agent 状态: $(systemctl is-active wiremesh-agent)"
`;

  return new NextResponse(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
