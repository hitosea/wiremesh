"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LineNode = {
  hopOrder: number;
  role: string;
  nodeId: number;
  nodeName: string;
  nodeStatus: string;
};

type LineTunnel = {
  id: number;
  hopIndex: number;
  fromNodeId: number;
  fromNodeName: string;
  toNodeId: number;
  toNodeName: string;
  fromWgPublicKey: string;
  fromWgAddress: string;
  fromWgPort: number;
  toWgPublicKey: string;
  toWgAddress: string;
  toWgPort: number;
};

type LineDetail = {
  id: number;
  name: string;
  status: string;
  tags: string | null;
  remark: string | null;
  nodes: LineNode[];
  tunnels: LineTunnel[];
  deviceCount: number;
};

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  inactive: "停用",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  inactive: "secondary",
};

const ROLE_LABELS: Record<string, string> = {
  entry: "入口",
  relay: "中转",
  exit: "出口",
};

const NODE_STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  installing: "安装中",
  error: "异常",
};

const NODE_STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  installing: "outline",
  error: "destructive",
};

export default function LineDetailPage() {
  const router = useRouter();
  const params = useParams();
  const lineId = params.id as string;

  const [line, setLine] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    fetch(`/api/lines/${lineId}`)
      .then((res) => res.json())
      .then((json) => {
        const l = json.data;
        if (!l) {
          toast.error("线路不存在");
          router.push("/lines");
          return;
        }
        setLine(l);
        setName(l.name ?? "");
        setStatus(l.status ?? "active");
        setTags(l.tags ?? "");
        setRemark(l.remark ?? "");
      })
      .catch(() => toast.error("加载线路失败"))
      .finally(() => setLoading(false));
  }, [lineId, router]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("线路名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/lines/${lineId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          status,
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success("线路已保存");
        setLine((prev) => (prev ? { ...prev, ...json.data } : prev));
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

  if (!line) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{line.name}</h1>
          <Badge variant={STATUS_VARIANTS[line.status] ?? "secondary"}>
            {STATUS_LABELS[line.status] ?? line.status}
          </Badge>
        </div>
        <Button variant="outline" onClick={() => router.push("/lines")}>
          返回
        </Button>
      </div>

      {/* Node chain card */}
      <Card>
        <CardHeader>
          <CardTitle>节点链路</CardTitle>
        </CardHeader>
        <CardContent>
          {line.nodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无节点数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>序号</TableHead>
                  <TableHead>节点名称</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>节点状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {line.nodes.map((n) => (
                  <TableRow key={n.nodeId}>
                    <TableCell>{n.hopOrder + 1}</TableCell>
                    <TableCell>
                      <Link
                        href={`/nodes/${n.nodeId}`}
                        className="text-primary hover:underline"
                      >
                        {n.nodeName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {ROLE_LABELS[n.role] ?? n.role}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          NODE_STATUS_VARIANTS[n.nodeStatus] ?? "secondary"
                        }
                      >
                        {NODE_STATUS_LABELS[n.nodeStatus] ?? n.nodeStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Tunnel info card */}
      <Card>
        <CardHeader>
          <CardTitle>隧道信息</CardTitle>
        </CardHeader>
        <CardContent>
          {line.tunnels.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无隧道数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>段</TableHead>
                  <TableHead>起点节点</TableHead>
                  <TableHead>终点节点</TableHead>
                  <TableHead>起点地址</TableHead>
                  <TableHead>终点地址</TableHead>
                  <TableHead>起点端口</TableHead>
                  <TableHead>终点端口</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {line.tunnels.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.hopIndex + 1}</TableCell>
                    <TableCell>{t.fromNodeName}</TableCell>
                    <TableCell>{t.toNodeName}</TableCell>
                    <TableCell>
                      <code className="text-xs">{t.fromWgAddress}</code>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{t.toWgAddress}</code>
                    </TableCell>
                    <TableCell>{t.fromWgPort}</TableCell>
                    <TableCell>{t.toWgPort}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Associated devices */}
      <Card>
        <CardHeader>
          <CardTitle>关联设备</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            共关联{" "}
            <Link
              href={`/devices?lineId=${line.id}`}
              className="text-primary hover:underline font-medium"
            >
              {line.deviceCount} 台设备
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader>
          <CardTitle>编辑线路</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">
              线路名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">状态</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">活跃</SelectItem>
                <SelectItem value="inactive">停用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：低延迟,稳定"
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
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/lines")}>
          返回
        </Button>
      </div>
    </div>
  );
}
