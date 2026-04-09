"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
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

type DeviceInfo = {
  id: number;
  name: string;
  lineId: number | null;
};

type LineInfo = {
  id: number;
  name: string;
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
  const t = useTranslations("deviceConfig");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const params = useParams();
  const router = useRouter();
  const deviceId = params.id as string;

  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lineName, setLineName] = useState<string | null>(null);

  useEffect(() => {
    // Fetch config
    fetch(`/api/devices/${deviceId}/config`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(translateError(json.error, te, t("loadFailed")));
        return json.data as ConfigData;
      })
      .then((data) => setConfigData(data))
      .catch((err) => toast.error(err.message ?? t("loadFailed")))
      .finally(() => setLoading(false));

    // Fetch device info to get lineId, then resolve line name
    fetch(`/api/devices/${deviceId}`)
      .then((res) => res.json())
      .then((json) => {
        const d = json.data as DeviceInfo | undefined;
        if (d?.lineId) {
          fetch(`/api/lines/${d.lineId}`)
            .then((res) => res.json())
            .then((lj) => setLineName((lj.data as LineInfo)?.name ?? null))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [deviceId]);

  const handleCopy = (text?: string) => {
    const content = text ?? configData?.config;
    if (!content) return;
    navigator.clipboard
      .writeText(content)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));
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

  const isXray = configData?.format === "xray";
  const shadowrocketUri = configData ? buildShadowrocketUri(configData) : null;
  const clashConfig = configData ? buildClashMeta(configData) : null;

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={() => router.push("/devices")}>
          {tc("back")}
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent>
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              {tc("loading")}
            </div>
          </CardContent>
        </Card>
      ) : !configData ? (
        <Card>
          <CardContent>
            <div className="text-muted-foreground text-sm py-8 text-center">
              {t("cannotLoad")}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Line info */}
          {lineName && (
            <div className="text-sm text-muted-foreground">
              {t("belongsToLine")}<span className="font-medium text-foreground">{lineName}</span>
            </div>
          )}

          {/* Config card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>
                {t("configTitle", { format: configData.format === "wireguard" ? "WireGuard" : configData.format === "xray" ? "Xray" : configData.format })}
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleCopy()}>
                  {tc("copy")}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  {tc("download")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push(`/devices/${deviceId}?from=config`)}>
                  {tc("edit")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto max-h-[500px] whitespace-pre-wrap break-all">
                {configData.config}
              </pre>
            </CardContent>
          </Card>

          {/* QR code card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("qrCode")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isXray && configData.shareLink ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t("xrayQrHint")}
                  </p>
                  <div className="flex justify-center rounded-lg bg-white p-4">
                    <QRCodeSVG value={configData.shareLink} size={260} />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t("wgQrHint")}
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
                <CardTitle>{t("clientConfig")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="sharelink">
                  <TabsList>
                    <TabsTrigger value="sharelink">{t("shareLink")}</TabsTrigger>
                    <TabsTrigger value="shadowrocket">{t("shadowrocket")}</TabsTrigger>
                    {clashConfig && <TabsTrigger value="clash">{t("clashMeta")}</TabsTrigger>}
                  </TabsList>

                  <TabsContent value="sharelink" className="mt-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {t("shareLinkHint")}
                    </p>
                    <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto whitespace-pre-wrap break-all">
                      {configData.shareLink}
                    </pre>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(configData.shareLink)}
                    >
                      {t("copyLink")}
                    </Button>
                  </TabsContent>

                  <TabsContent value="shadowrocket" className="mt-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {t("shadowrocketHint")}
                    </p>
                    <div className="space-y-2 text-sm">
                      <h4 className="font-medium">{t("manualConfig")}</h4>
                      <div className="code-block rounded-lg p-4 text-xs space-y-1">
                        <ConfigRow label={t("type")} value="VLESS" />
                        <ConfigRow label={t("address")} value={getXrayField(configData, "address")} />
                        <ConfigRow label={t("port")} value={getXrayField(configData, "port")} />
                        <ConfigRow label={t("uuid")} value={getXrayField(configData, "uuid")} />
                        <ConfigRow label={t("flow")} value="xtls-rprx-vision" />
                        <ConfigRow label={t("transport")} value="tcp" />
                        <ConfigRow label={t("tls")} value="reality" />
                        <ConfigRow label={t("sni")} value={getXrayField(configData, "sni")} />
                        <ConfigRow label={t("fingerprint")} value="chrome" />
                        <ConfigRow label={t("publicKey")} value={getXrayField(configData, "publicKey")} />
                        <ConfigRow label={t("shortId")} value={getXrayField(configData, "shortId")} />
                      </div>
                    </div>
                  </TabsContent>

                  {clashConfig && (
                    <TabsContent value="clash" className="mt-4 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {t("clashHint")}
                      </p>
                      <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto whitespace-pre-wrap break-all">
                        {clashConfig}
                      </pre>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(clashConfig)}
                      >
                        {t("copyConfig")}
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
