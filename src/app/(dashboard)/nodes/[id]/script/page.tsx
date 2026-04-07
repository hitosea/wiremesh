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

  const [oneliner, setOneliner] = useState("");
  const [script, setScript] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch node detail to get agentToken
    fetch(`/api/nodes/${nodeId}`)
      .then((res) => res.json())
      .then((res) => {
        const token = res.data?.agentToken;
        const origin = window.location.origin;
        setOneliner(
          `curl -fsSL '${origin}/api/nodes/${nodeId}/script?token=${token}' | bash`
        );
      })
      .catch(() => toast.error("获取节点信息失败"));

    // Load full script for preview
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
      .writeText(oneliner)
      .then(() => toast.success("安装命令已复制"))
      .catch(() => toast.error("复制失败"));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">安装脚本</h1>
        <Button variant="outline" onClick={() => router.push(`/nodes/${nodeId}`)}>
          返回
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>一键安装命令</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            在目标服务器上以 root 身份执行以下命令：
          </p>
          <div className="flex gap-2">
            <pre className="flex-1 bg-gray-900 text-gray-100 p-3 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap break-all">
              {oneliner || "加载中..."}
            </pre>
            <Button onClick={handleCopy} disabled={!oneliner}>
              复制
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <h3 className="font-medium mb-2">使用说明</h3>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>复制上方命令，粘贴到节点服务器终端以 root 身份运行</li>
            <li>脚本将自动安装 WireGuard、下载并启动 Agent</li>
            <li>安装完成后，节点状态将自动更新为"在线"</li>
            <li>如遇问题，可通过 <code className="bg-muted px-1 rounded">journalctl -u wiremesh-agent -f</code> 查看日志</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">完整脚本预览</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFull(!showFull)}
            >
              {showFull ? "收起" : "展开"}
            </Button>
          </div>
        </CardHeader>
        {showFull && (
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground">
                加载中...
              </div>
            ) : (
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-auto max-h-[500px] whitespace-pre-wrap break-all">
                {script}
              </pre>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
