"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type NodeStat = { total: number; online: number; offline: number; error: number };
type DeviceStat = { total: number; online: number; offline: number };
type LineStat = { total: number; active: number; inactive: number };
type TrafficNode = {
  nodeId: number;
  nodeName: string;
  nodeIp: string;
  uploadBytes: number;
  downloadBytes: number;
};
type TrafficStat = {
  totalUploadBytes: number;
  totalDownloadBytes: number;
  nodes: TrafficNode[];
};
type RecentNode = {
  id: number;
  name: string;
  ip: string;
  wgAddress: string;
  status: string;
  updatedAt: string;
};
type RecentDevice = {
  id: number;
  name: string;
  protocol: string;
  wgAddress: string | null;
  status: string;
  lineId: number | null;
  updatedAt: string;
};

type DashboardData = {
  nodes: NodeStat;
  devices: DeviceStat;
  lines: LineStat;
  traffic: TrafficStat;
  recentNodes: RecentNode[];
  recentDevices: RecentDevice[];
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

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

const DEVICE_STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  error: "异常",
  "-": "-",
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((json) => setData(json.data))
      .catch(() => toast.error("加载仪表盘数据失败"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">仪表盘</h1>
        <p className="text-gray-500">加载数据失败</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">仪表盘</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">节点</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.nodes.total}</div>
            <div className="text-sm text-muted-foreground mt-1 space-x-3">
              <span className="text-green-600">在线 {data.nodes.online}</span>
              <span>离线 {data.nodes.offline}</span>
              {data.nodes.error > 0 && (
                <span className="text-red-500">异常 {data.nodes.error}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">设备</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.devices.total}</div>
            <div className="text-sm text-muted-foreground mt-1 space-x-3">
              <span className="text-green-600">在线 {data.devices.online}</span>
              <span>离线 {data.devices.offline}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">线路</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.lines.total}</div>
            <div className="text-sm text-muted-foreground mt-1 space-x-3">
              <span className="text-green-600">活跃 {data.lines.active}</span>
              <span>停用 {data.lines.inactive}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Nodes & Devices */}
      <div className="grid grid-cols-2 gap-6">
        {/* Recent Nodes */}
        <Card>
          <CardHeader>
            <CardTitle>节点状态</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentNodes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      暂无节点
                    </TableCell>
                  </TableRow>
                ) : (
                  data.recentNodes.map((node) => (
                    <TableRow key={node.id}>
                      <TableCell>
                        <Link
                          href={`/nodes/${node.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {node.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {node.ip}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={NODE_STATUS_VARIANTS[node.status] ?? "secondary"}
                        >
                          {NODE_STATUS_LABELS[node.status] ?? node.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Devices */}
        <Card>
          <CardHeader>
            <CardTitle>设备状态</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>协议</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentDevices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      暂无设备
                    </TableCell>
                  </TableRow>
                ) : (
                  data.recentDevices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell>
                        <Link
                          href={`/devices/${device.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {device.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground uppercase">
                        {device.protocol}
                      </TableCell>
                      <TableCell>
                        {device.status === "-" ? (
                          <span className="text-muted-foreground text-sm">-</span>
                        ) : (
                          <Badge
                            variant={
                              NODE_STATUS_VARIANTS[device.status] ?? "secondary"
                            }
                          >
                            {DEVICE_STATUS_LABELS[device.status] ?? device.status}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Traffic Table */}
      {data.traffic.nodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>节点流量</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>上传</TableHead>
                  <TableHead>下载</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.traffic.nodes.map((t) => (
                  <TableRow key={t.nodeId}>
                    <TableCell>
                      <Link
                        href={`/nodes/${t.nodeId}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {t.nodeName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.nodeIp}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatBytes(t.uploadBytes)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatBytes(t.downloadBytes)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium bg-muted/50">
                  <TableCell colSpan={2}>合计</TableCell>
                  <TableCell>{formatBytes(data.traffic.totalUploadBytes)}</TableCell>
                  <TableCell>{formatBytes(data.traffic.totalDownloadBytes)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
