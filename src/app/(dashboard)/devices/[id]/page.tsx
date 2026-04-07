"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type DeviceDetail = {
  id: number;
  name: string;
  protocol: string;
  wgPublicKey: string | null;
  wgAddress: string | null;
  xrayUuid: string | null;
  xrayConfig: string | null;
  lineId: number | null;
  status: string;
  lastHandshake: string | null;
  tags: string | null;
  remark: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  error: "异常",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
};

const PROTOCOL_LABELS: Record<string, string> = {
  wireguard: "WireGuard",
  xray: "Xray",
};

export default function DeviceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deviceId = params.id as string;

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");
  const [lineId, setLineId] = useState("");

  useEffect(() => {
    fetch(`/api/devices/${deviceId}`)
      .then((res) => res.json())
      .then((json) => {
        const d = json.data;
        if (!d) {
          toast.error("设备不存在");
          router.push("/devices");
          return;
        }
        setDevice(d);
        setName(d.name ?? "");
        setTags(d.tags ?? "");
        setRemark(d.remark ?? "");
        setLineId(d.lineId ? String(d.lineId) : "");
      })
      .catch(() => toast.error("加载设备失败"))
      .finally(() => setLoading(false));
  }, [deviceId, router]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("设备名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "保存失败");
        return;
      }

      // Update line assignment if changed
      const parsedLineId = lineId ? parseInt(lineId) : null;
      if (parsedLineId !== device?.lineId) {
        const lineRes = await fetch(`/api/devices/${deviceId}/line`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineId: parsedLineId }),
        });
        const lineJson = await lineRes.json();
        if (!lineRes.ok) {
          toast.error(lineJson.error?.message ?? "更新线路失败");
          return;
        }
      }

      toast.success("设备已保存");
      setDevice({ ...json.data, lineId: parsedLineId });
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

  if (!device) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          {device.status === "-" ? (
            <span className="text-muted-foreground text-sm">-</span>
          ) : (
            <Badge variant={STATUS_VARIANTS[device.status] ?? "secondary"}>
              {STATUS_LABELS[device.status] ?? device.status}
            </Badge>
          )}
        </div>
        <Button variant="outline" onClick={() => router.push("/devices")}>
          返回
        </Button>
      </div>

      {/* Read-only info */}
      <Card>
        <CardHeader>
          <CardTitle>设备信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>协议</Label>
            <p className="text-sm font-medium">
              {PROTOCOL_LABELS[device.protocol] ?? device.protocol}
            </p>
          </div>
          {device.protocol === "wireguard" && (
            <>
              <div className="space-y-1">
                <Label>WireGuard 内网地址</Label>
                <p className="text-sm font-medium">{device.wgAddress ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <Label>WireGuard 公钥</Label>
                <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                  {device.wgPublicKey ?? "—"}
                </code>
              </div>
            </>
          )}
          {device.protocol === "xray" && (
            <div className="space-y-1">
              <Label>Xray UUID</Label>
              <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                {device.xrayUuid ?? "—"}
              </code>
            </div>
          )}
          {device.lastHandshake && (
            <div className="space-y-1">
              <Label>最后握手时间</Label>
              <p className="text-sm text-muted-foreground">
                {device.lastHandshake}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader>
          <CardTitle>编辑设备</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">
              设备名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：工作,个人"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="remark">备注</Label>
            <Textarea
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lineId">线路 ID</Label>
            <Input
              id="lineId"
              type="number"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              placeholder="留空表示不绑定线路"
            />
            <p className="text-xs text-muted-foreground">
              输入线路 ID 绑定到指定线路，留空取消绑定
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/devices")}>
          返回
        </Button>
      </div>
    </div>
  );
}
