"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type StatusRecord = {
  isOnline: boolean;
  latency: number | null;
  uploadBytes: number;
  downloadBytes: number;
  checkedAt: string;
};

type ChartPoint = {
  time: string;
  latency: number | null;
  upload: number;
  download: number;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

export function NodeStatusChart({ nodeId }: { nodeId: string }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/nodes/${nodeId}/status?page=1&pageSize=100`)
      .then((res) => res.json())
      .then((json) => {
        const records: StatusRecord[] = json.data ?? [];
        const reversed = [...records].reverse();
        const mapped: ChartPoint[] = reversed.map((r) => {
          const date = new Date(r.checkedAt);
          const hh = String(date.getHours()).padStart(2, "0");
          const mm = String(date.getMinutes()).padStart(2, "0");
          return {
            time: `${hh}:${mm}`,
            latency: r.latency,
            upload: r.uploadBytes,
            download: r.downloadBytes,
          };
        });
        setPoints(mapped);
      })
      .catch(() => toast.error("加载历史状态失败"))
      .finally(() => setLoading(false));
  }, [nodeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground">
        暂无历史数据
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>延迟 (ms)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="latency"
                stroke="hsl(var(--primary))"
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>流量</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis tickFormatter={formatBytes} />
              <Tooltip formatter={(value) => formatBytes(Number(value))} />
              <Area
                type="monotone"
                dataKey="upload"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.2}
                name="上传"
              />
              <Area
                type="monotone"
                dataKey="download"
                stroke="#22c55e"
                fill="#22c55e"
                fillOpacity={0.2}
                name="下载"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
