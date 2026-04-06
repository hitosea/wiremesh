"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NodeScriptPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.id as string;

  const [script, setScript] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/nodes/${nodeId}/script`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error?.message ?? "加载失败");
        }
        return res.text();
      })
      .then((text) => setScript(text))
      .catch((err) => toast.error(err.message ?? "加载脚本失败"))
      .finally(() => setLoading(false));
  }, [nodeId]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(script)
      .then(() => toast.success("脚本已复制到剪贴板"))
      .catch(() => toast.error("复制失败，请手动复制"));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">安装脚本</h1>
        <div className="flex gap-2">
          <Button onClick={handleCopy} disabled={loading || !script}>
            复制脚本
          </Button>
          <Button variant="outline" onClick={() => router.push(`/nodes/${nodeId}`)}>
            返回
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>节点安装脚本</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              加载中...
            </div>
          ) : (
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-auto max-h-[600px] whitespace-pre-wrap break-all">
              {script}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <h3 className="font-medium mb-2">使用说明</h3>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>在目标节点服务器上以 root 身份运行此脚本</li>
            <li>脚本将自动安装 WireGuard、下载并启动 wiremesh-agent</li>
            <li>安装完成后，节点状态将在几秒内更新为"在线"</li>
            <li>如遇问题，可通过 <code className="bg-muted px-1 rounded">journalctl -u wiremesh-agent -f</code> 查看日志</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
