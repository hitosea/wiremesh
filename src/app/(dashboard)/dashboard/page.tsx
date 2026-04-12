"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { StatusDot } from "@/components/status-dot";
import { useAdminSSE } from "@/components/admin-sse-provider";
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


export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((json) => setData(json.data))
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Debounced re-fetch on status changes (node_status + device_status may fire together)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchDashboard(), 200);
  }, [fetchDashboard]);

  useAdminSSE("node_status", debouncedFetch);
  useAdminSSE("device_status", debouncedFetch);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("nodes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.nodes.total}</div>
            <div className="text-sm text-muted-foreground mt-1 space-x-3">
              <span className="text-emerald-500 dark:text-emerald-400">{t("online")} {data.nodes.online}</span>
              <span>{t("offline")} {data.nodes.offline}</span>
              {data.nodes.error > 0 && (
                <span className="text-destructive">{t("error")} {data.nodes.error}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("devices")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.devices.total}</div>
            <div className="text-sm text-muted-foreground mt-1 space-x-3">
              <span className="text-emerald-500 dark:text-emerald-400">{t("online")} {data.devices.online}</span>
              <span>{t("offline")} {data.devices.offline}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("lines")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.lines.total}</div>
            <div className="text-sm text-muted-foreground mt-1 space-x-3">
              <span className="text-emerald-500 dark:text-emerald-400">{t("active")} {data.lines.active}</span>
              <span>{t("disabled")} {data.lines.inactive}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Nodes & Devices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Nodes */}
        <Card>
          <CardHeader>
            <CardTitle>{t("nodeStatus")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("ip")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentNodes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      {t("noNodes")}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.recentNodes.map((node) => (
                    <TableRow key={node.id}>
                      <TableCell>
                        <Link
                          href={`/nodes/${node.id}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {node.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {node.ip}
                      </TableCell>
                      <TableCell>
                        <StatusDot status={node.status} label={t(node.status as "online" | "offline" | "error" | "installing")} />
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
            <CardTitle>{t("deviceStatus")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("protocol")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentDevices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      {t("noDevices")}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.recentDevices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell>
                        <Link
                          href={`/devices/${device.id}`}
                          className="text-primary hover:underline font-medium"
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
                          <StatusDot status={device.status} label={t(device.status as "online" | "offline" | "error")} />
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
            <CardTitle>{t("nodeTraffic")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("nodes")}</TableHead>
                  <TableHead>{t("ip")}</TableHead>
                  <TableHead>{t("upload")}</TableHead>
                  <TableHead>{t("download")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.traffic.nodes.map((tn) => (
                  <TableRow key={tn.nodeId}>
                    <TableCell>
                      <Link
                        href={`/nodes/${tn.nodeId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {tn.nodeName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tn.nodeIp}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatBytes(tn.uploadBytes)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatBytes(tn.downloadBytes)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium bg-muted/50">
                  <TableCell colSpan={2}>{t("total")}</TableCell>
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
