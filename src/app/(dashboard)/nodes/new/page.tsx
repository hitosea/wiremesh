"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { DEFAULT_REALITY_DEST } from "@/lib/reality-dest";

export default function NewNodePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");
  const [xrayEnabled, setXrayEnabled] = useState(false);
  const [xrayPort, setXrayPort] = useState("");
  const [realityDest, setRealityDest] = useState(DEFAULT_REALITY_DEST);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("节点名称不能为空");
      return;
    }
    if (!ip.trim()) {
      toast.error("IP 地址不能为空");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        ip: ip.trim(),
        domain: domain.trim() || null,
        port: port ? parseInt(port) : undefined,
        tags: tags.trim() || null,
        remark: remark.trim() || null,
        xrayEnabled,
      };
      if (xrayEnabled) {
        body.xrayPort = xrayPort ? parseInt(xrayPort) : null;
        body.realityDest = realityDest || undefined;
      }

      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (res.ok) {
        toast.success("节点创建成功");
        router.push("/nodes");
      } else {
        toast.error(json.error?.message ?? "创建失败");
      }
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">新增节点</h1>
        <Button variant="outline" onClick={() => router.back()}>
          返回
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
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
                placeholder="例如：香港节点01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ip">
                IP 地址 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ip"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="例如：1.2.3.4"
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
                placeholder="备注信息"
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Xray 设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建节点"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
