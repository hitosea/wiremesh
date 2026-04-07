"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NodeStatusChart } from "@/components/node-status-chart";

type NodeDetail = {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  port: number;
  agentToken: string;
  wgPublicKey: string;
  wgAddress: string;
  xrayEnabled: boolean;
  xrayProtocol: string | null;
  xrayTransport: string | null;
  xrayPort: number | null;
  xrayConfig: string | null;
  status: string;
  errorMessage: string | null;
  tags: string | null;
  remark: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  installing: "安装中",
  error: "异常",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  installing: "outline",
  error: "destructive",
};

export default function NodeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const nodeId = params.id as string;

  const [node, setNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");
  const [xrayEnabled, setXrayEnabled] = useState(false);
  const [xrayPort, setXrayPort] = useState("");
  const [realityDest, setRealityDest] = useState("");
  const [realityPublicKey, setRealityPublicKey] = useState("");
  const [realityShortId, setRealityShortId] = useState("");

  useEffect(() => {
    fetch(`/api/nodes/${nodeId}`)
      .then((res) => res.json())
      .then((json) => {
        const n = json.data;
        if (!n) {
          toast.error("节点不存在");
          router.push("/nodes");
          return;
        }
        setNode(n);
        setName(n.name ?? "");
        setIp(n.ip ?? "");
        setDomain(n.domain ?? "");
        setPort(n.port ? String(n.port) : "");
        setTags(n.tags ?? "");
        setRemark(n.remark ?? "");
        setXrayEnabled(n.xrayEnabled ?? false);
        setXrayPort(n.xrayPort ? String(n.xrayPort) : "");
        if (n.xrayConfig) {
          try {
            const cfg = JSON.parse(n.xrayConfig);
            setRealityDest(cfg.realityDest ?? "");
            setRealityPublicKey(cfg.realityPublicKey ?? "");
            setRealityShortId(cfg.realityShortId ?? "");
          } catch {}
        }
      })
      .catch(() => toast.error("加载节点失败"))
      .finally(() => setLoading(false));
  }, [nodeId, router]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("节点名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        ip: ip.trim(),
        domain: domain.trim() || null,
        port: port ? parseInt(port) : undefined,
        tags: tags.trim() || null,
        remark: remark.trim() || null,
        xrayEnabled,
        xrayPort: xrayEnabled && xrayPort ? parseInt(xrayPort) : null,
        realityDest: xrayEnabled ? realityDest || "www.microsoft.com:443" : undefined,
        realityServerName: xrayEnabled
          ? (realityDest || "www.microsoft.com:443").replace(/:\d+$/, "")
          : undefined,
      };

      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success("节点已保存");
        setNode(json.data);
      } else {
        toast.error(json.error?.message ?? "保存失败");
      }
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!node) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{node.name}</h1>
          <Badge variant={STATUS_VARIANTS[node.status] ?? "secondary"}>
            {STATUS_LABELS[node.status] ?? node.status}
          </Badge>
        </div>
        <Button variant="outline" onClick={() => router.push("/nodes")}>
          返回
        </Button>
      </div>

      <div className="w-full max-w-2xl space-y-6">
      {/* Read-only info */}
      <Card>
        <CardHeader>
          <CardTitle>节点信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>WireGuard 内网地址</Label>
            <p className="text-sm font-medium">{node.wgAddress}</p>
          </div>
          <div className="space-y-2">
            <Label>WireGuard 公钥</Label>
            <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
              {node.wgPublicKey}
            </code>
          </div>
          <div className="space-y-2">
            <Label>Agent Token</Label>
            <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
              {node.agentToken}
            </code>
          </div>
          {node.errorMessage && (
            <div className="space-y-2">
              <Label className="text-destructive">错误信息</Label>
              <p className="text-sm text-destructive">{node.errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader>
          <CardTitle>编辑节点</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              节点名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ip">IP 地址</Label>
            <Input
              id="ip"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="domain">域名</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="例如：node1.example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">WireGuard 端口</Label>
            <Input
              id="port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="41820"
            />
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="xrayEnabled"
                checked={xrayEnabled}
                onCheckedChange={setXrayEnabled}
              />
              <Label htmlFor="xrayEnabled">启用 Xray 入口代理</Label>
            </div>
            {xrayEnabled && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="xrayPort">Xray 端口</Label>
                  <Input
                    id="xrayPort"
                    type="number"
                    value={xrayPort}
                    onChange={(e) => setXrayPort(e.target.value)}
                    placeholder="443"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="realityDest">Reality 目标网站</Label>
                  <Input
                    id="realityDest"
                    value={realityDest}
                    onChange={(e) => setRealityDest(e.target.value)}
                    placeholder="www.microsoft.com:443"
                  />
                  <p className="text-xs text-muted-foreground">
                    伪装目标，需支持 TLS 1.3，如 www.microsoft.com:443
                  </p>
                </div>
                {realityPublicKey && (
                  <>
                    <div className="space-y-2">
                      <Label>Reality Public Key</Label>
                      <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                        {realityPublicKey}
                      </code>
                    </div>
                    <div className="space-y-2">
                      <Label>Reality Short ID</Label>
                      <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                        {realityShortId}
                      </code>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：香港,高速"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remark">备注</Label>
            <Textarea
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/nodes")}>
          返回
        </Button>
      </div>
      </div>

      <NodeStatusChart nodeId={nodeId} />
    </div>
  );
}
