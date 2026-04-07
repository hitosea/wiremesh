"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ConfigData = {
  format: string;
  config: string;
  filename: string;
  shareLink?: string;
};

function buildShadowrocketUri(data: ConfigData): string | null {
  if (!data.shareLink) return null;
  // Shadowrocket can import standard VLESS share links directly
  return data.shareLink;
}

function buildClashMeta(data: ConfigData): string | null {
  if (data.format !== "xray" || !data.shareLink) return null;
  try {
    const parsed = JSON.parse(data.config);
    const vnext = parsed.outbounds?.[0]?.settings?.vnext?.[0];
    const stream = parsed.outbounds?.[0]?.streamSettings;
    const reality = stream?.realitySettings;
    if (!vnext || !reality) return null;

    const proxy = {
      name: "WireMesh",
      type: "vless",
      server: vnext.address,
      port: vnext.port,
      uuid: vnext.users?.[0]?.id,
      network: "tcp",
      tls: true,
      flow: "xtls-rprx-vision",
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": reality.publicKey,
        "short-id": reality.shortId,
      },
      servername: reality.serverName,
    };

    return `proxies:\n${yamlIndent(proxy)}`;
  } catch {
    return null;
  }
}

function yamlIndent(obj: Record<string, unknown>, indent = 2): string {
  const pad = " ".repeat(indent);
  return (
    `${pad}- ` +
    Object.entries(obj)
      .map(([k, v], i) => {
        const prefix = i === 0 ? "" : pad + "  ";
        if (typeof v === "object" && v !== null) {
          return `${prefix}${k}:\n${Object.entries(v as Record<string, unknown>)
            .map(([sk, sv]) => `${pad}    ${sk}: ${JSON.stringify(sv)}`)
            .join("\n")}`;
        }
        return `${prefix}${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`;
      })
      .join("\n")
  );
}

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

  const handleCopy = (text?: string) => {
    const content = text ?? configData?.config;
    if (!content) return;
    navigator.clipboard
      .writeText(content)
      .then(() => toast.success("已复制到剪贴板"))
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

  const isXray = configData?.format === "xray";
  const shadowrocketUri = configData ? buildShadowrocketUri(configData) : null;
  const clashConfig = configData ? buildClashMeta(configData) : null;

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">客户端配置</h1>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={() => handleCopy()} disabled={loading || !configData}>
            复制
          </Button>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={loading || !configData}
          >
            下载
          </Button>
          <Button variant="outline" onClick={() => router.push("/devices")}>
            返回
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent>
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              加载中...
            </div>
          </CardContent>
        </Card>
      ) : !configData ? (
        <Card>
          <CardContent>
            <div className="text-muted-foreground text-sm py-8 text-center">
              无法加载配置，请确认设备已绑定线路
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Config card */}
          <Card>
            <CardHeader>
              <CardTitle>
                {formatLabel[configData.format] ?? configData.format} 配置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                文件名：<code className="bg-muted px-1 rounded">{configData.filename}</code>
              </p>
              <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto max-h-[500px] whitespace-pre-wrap break-all">
                {configData.config}
              </pre>
            </CardContent>
          </Card>

          {/* QR code card */}
          <Card>
            <CardHeader>
              <CardTitle>二维码</CardTitle>
            </CardHeader>
            <CardContent>
              {isXray && configData.shareLink ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    使用 Shadowrocket、v2rayN 等客户端扫码导入
                  </p>
                  <div className="flex justify-center rounded-lg bg-white p-4">
                    <QRCodeSVG value={configData.shareLink} size={260} />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    使用 WireGuard 客户端扫码导入
                  </p>
                  <div className="flex justify-center rounded-lg bg-white p-4">
                    <QRCodeSVG value={configData.config} size={260} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Xray client configs */}
          {isXray && (
            <Card>
              <CardHeader>
                <CardTitle>常用客户端配置</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="sharelink">
                  <TabsList>
                    <TabsTrigger value="sharelink">分享链接</TabsTrigger>
                    <TabsTrigger value="shadowrocket">Shadowrocket</TabsTrigger>
                    {clashConfig && <TabsTrigger value="clash">Clash Meta</TabsTrigger>}
                  </TabsList>

                  <TabsContent value="sharelink" className="mt-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      适用于 v2rayN、v2rayNG、Nekoray 等客户端，复制后直接从剪贴板导入
                    </p>
                    <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto whitespace-pre-wrap break-all">
                      {configData.shareLink}
                    </pre>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(configData.shareLink)}
                    >
                      复制链接
                    </Button>
                  </TabsContent>

                  <TabsContent value="shadowrocket" className="mt-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Shadowrocket (iOS) 支持直接扫描上方二维码导入，或复制分享链接后在 App 中选择「从剪贴板导入」
                    </p>
                    <div className="space-y-2 text-sm">
                      <h4 className="font-medium">手动配置参数</h4>
                      <div className="code-block rounded-lg p-4 text-xs space-y-1">
                        <ConfigRow label="类型" value="VLESS" />
                        <ConfigRow label="地址" value={getXrayField(configData, "address")} />
                        <ConfigRow label="端口" value={getXrayField(configData, "port")} />
                        <ConfigRow label="UUID" value={getXrayField(configData, "uuid")} />
                        <ConfigRow label="流控" value="xtls-rprx-vision" />
                        <ConfigRow label="传输" value="tcp" />
                        <ConfigRow label="TLS" value="reality" />
                        <ConfigRow label="SNI" value={getXrayField(configData, "sni")} />
                        <ConfigRow label="指纹" value="chrome" />
                        <ConfigRow label="公钥" value={getXrayField(configData, "publicKey")} />
                        <ConfigRow label="Short ID" value={getXrayField(configData, "shortId")} />
                      </div>
                    </div>
                  </TabsContent>

                  {clashConfig && (
                    <TabsContent value="clash" className="mt-4 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        适用于 Clash Meta / Clash Verge，复制后添加到 proxies 配置段
                      </p>
                      <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto whitespace-pre-wrap break-all">
                        {clashConfig}
                      </pre>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(clashConfig)}
                      >
                        复制配置
                      </Button>
                    </TabsContent>
                  )}
                </Tabs>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function getXrayField(data: ConfigData, field: string): string {
  try {
    const parsed = JSON.parse(data.config);
    const vnext = parsed.outbounds?.[0]?.settings?.vnext?.[0];
    const reality = parsed.outbounds?.[0]?.streamSettings?.realitySettings;
    switch (field) {
      case "address": return vnext?.address ?? "";
      case "port": return String(vnext?.port ?? "");
      case "uuid": return vnext?.users?.[0]?.id ?? "";
      case "sni": return reality?.serverName ?? "";
      case "publicKey": return reality?.publicKey ?? "";
      case "shortId": return reality?.shortId ?? "";
      default: return "";
    }
  } catch {
    return "";
  }
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="font-mono break-all">{value}</span>
    </div>
  );
}
