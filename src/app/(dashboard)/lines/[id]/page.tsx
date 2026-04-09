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
import { StatusDot } from "@/components/status-dot";
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

type BranchFilter = {
  filterId: number;
  filterName: string;
};

type Branch = {
  id: number;
  name: string;
  isDefault: boolean;
  nodes: LineNode[];
  filters: BranchFilter[];
};

type LineDetail = {
  id: number;
  name: string;
  status: string;
  tags: string | null;
  remark: string | null;
  nodes: LineNode[];
  tunnels: LineTunnel[];
  branches: Branch[];
  deviceCount: number;
};

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  inactive: "停用",
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
    <div className="space-y-6 w-full max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{line.name}</h1>
          <StatusDot status={line.status} label={STATUS_LABELS[line.status] ?? line.status} />
        </div>
        <Button variant="outline" onClick={() => router.push("/lines")}>
          返回
        </Button>
      </div>

      {/* Basic info card */}
      {(() => {
        const entryNode = line.nodes.find((n) => n.role === "entry");
        return (
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground w-20 shrink-0">名称</span>
                <span>{line.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground w-20 shrink-0">入口节点</span>
                {entryNode ? (
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/nodes/${entryNode.nodeId}`}
                      className="text-primary hover:underline"
                    >
                      {entryNode.nodeName}
                    </Link>
                    <StatusDot status={entryNode.nodeStatus} label={NODE_STATUS_LABELS[entryNode.nodeStatus] ?? entryNode.nodeStatus} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">未设置</span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Branch topology */}
      <Card>
        <CardHeader>
          <CardTitle>分支拓扑</CardTitle>
        </CardHeader>
        <CardContent>
          {line.branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无分支数据</p>
          ) : (
            <div className="space-y-3">
              {line.branches.map((branch) => {
                const entryNode = line.nodes.find((n) => n.role === "entry");
                const branchNodeNames = branch.nodes
                  .sort((a, b) => a.hopOrder - b.hopOrder)
                  .map((n) => n.nodeName);
                const chainParts = entryNode
                  ? [entryNode.nodeName, ...branchNodeNames]
                  : branchNodeNames;
                const chainStr = chainParts.join(" → ");

                return (
                  <div
                    key={branch.id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{branch.name}</span>
                      {branch.isDefault && (
                        <Badge variant="outline">默认</Badge>
                      )}
                    </div>
                    <div className="text-sm font-mono text-muted-foreground">
                      {chainStr || "无节点"}
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground">分流规则:</span>
                      {branch.filters.length === 0 ? (
                        <span className="text-muted-foreground">(无)</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {branch.filters.map((f) => (
                            <Badge key={f.filterId} variant="secondary">
                              {f.filterName}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
          <div className="space-y-2">
            <Label htmlFor="name">
              线路名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
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
          <div className="space-y-2">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：低延迟,稳定"
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
        <Button variant="outline" onClick={() => router.push("/lines")}>
          返回
        </Button>
      </div>
    </div>
  );
}
