"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("nodeStatusChart");
  const tc = useTranslations("common");
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
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [nodeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("latency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
              <YAxis fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--popover-foreground))",
                  borderRadius: "var(--radius)",
                }}
              />
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
          <CardTitle>{t("traffic")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickFormatter={formatBytes} fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                formatter={(value) => formatBytes(Number(value))}
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--popover-foreground))",
                  borderRadius: "var(--radius)",
                }}
              />
              <Area
                type="monotone"
                dataKey="upload"
                stroke="hsl(var(--chart-1))"
                fill="hsl(var(--chart-1))"
                fillOpacity={0.2}
                name={t("upload")}
              />
              <Area
                type="monotone"
                dataKey="download"
                stroke="hsl(var(--chart-2))"
                fill="hsl(var(--chart-2))"
                fillOpacity={0.2}
                name={t("download")}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
