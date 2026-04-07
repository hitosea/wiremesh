"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConfigData = {
  format: string;
  config: string;
  filename: string;
};

export default function DeviceConfigPage() {
  const params = useParams();
  const router = useRouter();
  const deviceId = params.id as string;

  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/devices/${deviceId}/config`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "加载失败");
        return json.data as ConfigData;
      })
      .then((data) => setConfigData(data))
      .catch((err) => toast.error(err.message ?? "加载配置失败"))
      .finally(() => setLoading(false));
  }, [deviceId]);

  const handleCopy = () => {
    if (!configData) return;
    navigator.clipboard
      .writeText(configData.config)
      .then(() => toast.success("配置已复制到剪贴板"))
      .catch(() => toast.error("复制失败，请手动复制"));
  };

  const handleDownload = () => {
    if (!configData) return;
    const blob = new Blob([configData.config], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = configData.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatLabel: Record<string, string> = {
    wireguard: "WireGuard",
    xray: "Xray",
  };

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">客户端配置</h1>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={handleCopy} disabled={loading || !configData}>
            复制
          </Button>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={loading || !configData}
          >
            下载
          </Button>
          <Button variant="outline" onClick={() => router.push(`/devices/${deviceId}`)}>
            返回
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {configData
              ? `${formatLabel[configData.format] ?? configData.format} 配置`
              : "客户端配置"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              加载中...
            </div>
          ) : configData ? (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                文件名：<code className="bg-muted px-1 rounded">{configData.filename}</code>
              </p>
              <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto max-h-[500px] whitespace-pre-wrap break-all">
                {configData.config}
              </pre>
            </>
          ) : (
            <div className="text-muted-foreground text-sm py-8 text-center">
              无法加载配置，请确认设备已绑定线路
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
