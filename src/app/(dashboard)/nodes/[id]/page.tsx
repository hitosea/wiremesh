"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusDot } from "@/components/status-dot";
import { NodeStatusChart } from "@/components/node-status-chart";
import { xrayPortHintParams } from "@/lib/port-hint";
import { parseTunnelPortBlacklist } from "@/lib/ip-allocator";
import { NodePortsDetail } from "@/components/node-ports-detail";
import { useAdminSSE } from "@/components/admin-sse-provider";
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-context";
import { Loader2 } from "lucide-react";

type NodeDetail = {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  port: number;
  agentToken: string;
  wgPublicKey: string;
  wgAddress: string;
  xrayProtocol: string | null;
  xrayTransport: string | null;
  xrayPort: number | null;
  xrayConfig: string | null;
  xrayWsPath: string | null;
  xrayTlsDomain: string | null;
  xrayTlsCert: string | null;
  xrayTlsKey: string | null;
  status: string;
  errorMessage: string | null;
  externalInterface: string;
  remark: string | null;
  agentVersion: string | null;
  xrayVersion: string | null;
  tunnelPortBlacklist: string;
  ports: {
    wg: number;
    xray: number[];
    tunnels: number[];
    socks5: number[];
  };
};


export default function NodeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const nodeId = params.id as string;
  const t = useTranslations("nodeDetail");
  const tn = useTranslations("nodeNew");
  const ts = useTranslations("nodes");
  const tc = useTranslations("common");
  const te = useTranslations("errors");

  const [node, setNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useSetBreadcrumbLabel(node?.name ?? null);

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");
  const [remark, setRemark] = useState("");
  const [externalInterface, setExternalInterface] = useState("eth0");
  const [xrayPort, setXrayPort] = useState("");
  const [realityDest, setRealityDest] = useState("");
  const [realityPublicKey, setRealityPublicKey] = useState("");
  const [realityShortId, setRealityShortId] = useState("");
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [xrayTransport, setXrayTransport] = useState("reality");
  const [tlsDomain, setTlsDomain] = useState("");
  const [tlsCertMode, setTlsCertMode] = useState<"auto" | "manual">("auto");
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");
  const [wsPath, setWsPath] = useState("");
  const [blacklistInput, setBlacklistInput] = useState("");
  const [addingPort, setAddingPort] = useState(false);
  const [removingPort, setRemovingPort] = useState<number | null>(null);
  const blacklistBusy = addingPort || removingPort !== null;

  const blacklistPorts: number[] = node ? parseTunnelPortBlacklist(node.tunnelPortBlacklist) : [];

  const saveBlacklist = async (newPorts: number[]): Promise<boolean> => {
    if (!node) return false;
    const csv = [...new Set(newPorts)].sort((a, b) => a - b).join(",");
    const r = await fetch(`/api/nodes/${node.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tunnelPortBlacklist: csv }),
    });
    if (r.ok) {
      toast.success(tc("save"));
      setNode({ ...node, tunnelPortBlacklist: csv });
      return true;
    }
    const json = await r.json();
    toast.error(translateError(json.error, te, tc("saveFailed")));
    return false;
  };

  const handleAddPort = async () => {
    const n = parseInt(blacklistInput.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      toast.error(t("invalidPort"));
      return;
    }
    setAddingPort(true);
    try {
      if (await saveBlacklist([...blacklistPorts, n])) {
        setBlacklistInput("");
      }
    } finally {
      setAddingPort(false);
    }
  };

  const handleRemovePort = async (port: number) => {
    setRemovingPort(port);
    try {
      await saveBlacklist(blacklistPorts.filter((p) => p !== port));
    } finally {
      setRemovingPort(null);
    }
  };

  useEffect(() => {
    fetch(`/api/nodes/${nodeId}`)
      .then((res) => res.json())
      .then((json) => {
        const n = json.data;
        if (!n) {
          toast.error(ts("notFound"));
          router.push("/nodes");
          return;
        }
        setNode(n);
        setName(n.name ?? "");
        setIp(n.ip ?? "");
        setDomain(n.domain ?? "");
        setPort(n.port ? String(n.port) : "");
        setRemark(n.remark ?? "");
        setExternalInterface(n.externalInterface ?? "eth0");
        setXrayPort(n.xrayPort ? String(n.xrayPort) : "");
        if (n.xrayConfig) {
          try {
            const cfg = JSON.parse(n.xrayConfig);
            setRealityDest(cfg.realityDest ?? "");
            setRealityPublicKey(cfg.realityPublicKey ?? "");
            setRealityShortId(cfg.realityShortId ?? "");
          } catch {}
        }
        setXrayTransport(n.xrayTransport === "ws-tls" ? "ws-tls" : "reality");
        setTlsDomain(n.xrayTlsDomain || "");
        setWsPath(n.xrayWsPath || "");
        if (n.xrayTlsCert) {
          setTlsCertMode("manual");
          setTlsCert(n.xrayTlsCert);
        }
        if (n.xrayTlsKey) {
          setTlsKey(n.xrayTlsKey);
        }
      })
      .catch(() => toast.error(ts("loadNodeFailed")))
      .finally(() => setLoading(false));
    fetch("/api/settings").then(r => r.json()).then(j => setDefaults(j.data ?? {})).catch(() => {});
  }, [nodeId, router]);

  // SSE real-time updates for this node
  useAdminSSE("node_status", (update) => {
    if (update.nodeId === Number(nodeId)) {
      setNode((prev) => prev ? { ...prev, ...update, id: prev.id } as NodeDetail : prev);
    }
  });

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(tn("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        ip: ip.trim(),
        domain: domain.trim() || null,
        port: port ? parseInt(port) : undefined,
        remark: remark.trim() || null,
        externalInterface: externalInterface.trim() || "eth0",
        xrayPort: xrayPort ? parseInt(xrayPort) : null,
        realityDest: realityDest || undefined,
      };
      body.xrayTransport = xrayTransport;
      if (xrayTransport === "ws-tls") {
        body.xrayTlsDomain = tlsDomain;
        if (tlsCertMode === "manual") {
          body.xrayTlsCert = tlsCert;
          body.xrayTlsKey = tlsKey;
        }
      }

      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(tc("save"));
        setNode(json.data);
      } else {
        toast.error(translateError(json.error, te, tc("saveFailed")));
      }
    } catch {
      toast.error(tc("saveFailedRetry"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {node ? (
              node.name
            ) : (
              <span className="inline-block h-7 w-48 rounded-md bg-muted animate-pulse align-middle" />
            )}
          </h1>
          {node && (
            <StatusDot status={node.status} label={ts(`status.${node.status}`)} />
          )}
        </div>
        <Button variant="outline" onClick={() => router.push("/nodes")}>
          {tc("back")}
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          {tc("loading")}
        </div>
      ) : node && (<>
      {/* Read-only info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("nodeInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("wgInternalAddress")}</Label>
            <p className="text-sm font-medium">{node.wgAddress}</p>
          </div>
          <div className="space-y-2">
            <Label>{t("wgPublicKey")}</Label>
            <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
              {node.wgPublicKey}
            </code>
          </div>
          <div className="space-y-2">
            <Label>{t("agentToken")}</Label>
            <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
              {node.agentToken}
            </code>
          </div>
          {node.agentVersion && (
            <div className="space-y-2">
              <Label>{ts("agentVersion")}</Label>
              <p className="text-sm font-medium">{node.agentVersion}</p>
            </div>
          )}
          {node.xrayVersion && (
            <div className="space-y-2">
              <Label>{ts("xrayVersion")}</Label>
              <p className="text-sm font-medium">{node.xrayVersion}</p>
            </div>
          )}
          {node.ports && (
            <div className="space-y-2">
              <Label>{ts("portsCol")}</Label>
              <NodePortsDetail ports={node.ports} />
            </div>
          )}
          {node.errorMessage && (
            <div className="space-y-2">
              <Label className="text-destructive">{t("errorMessage")}</Label>
              <p className="text-sm text-destructive">{node.errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tunnel port blacklist */}
      <Card>
        <CardHeader>
          <CardTitle>{t("tunnelPortBlacklist")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("tunnelPortBlacklistHint")}</p>
          {blacklistPorts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {blacklistPorts.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs">
                  {p}
                  <button
                    onClick={() => handleRemovePort(p)}
                    disabled={blacklistBusy}
                    className="hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                    aria-label="remove"
                  >
                    {removingPort === p ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "✕"
                    )}
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={65535}
              placeholder="41834"
              value={blacklistInput}
              onChange={(e) => setBlacklistInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !blacklistBusy && handleAddPort()}
              disabled={blacklistBusy}
              className="w-32"
            />
            <Button onClick={handleAddPort} disabled={blacklistBusy}>
              {addingPort && <Loader2 className="size-4 animate-spin" />}
              {t("addPort")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader>
          <CardTitle>{t("editNode")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {tn("nodeName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ip">{tn("ipAddress")}</Label>
            <Input
              id="ip"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="domain">{tn("domain")}</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={tn("domainPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{tn("domainHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">{tn("wgPort")}</Label>
            <Input
              id="port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={defaults.wg_default_port || "41820"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="externalInterface">{tn("externalInterface")}</Label>
            <Input
              id="externalInterface"
              value={externalInterface}
              onChange={(e) => setExternalInterface(e.target.value)}
              placeholder="eth0"
            />
            <p className="text-xs text-muted-foreground">
              {tn("externalInterfaceHint")}
            </p>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-medium">{tn("xraySettings")}</h3>
            <div className="space-y-2">
              <Label htmlFor="xrayPort">{tn("xrayStartPort")}</Label>
              <Input
                id="xrayPort"
                type="number"
                value={xrayPort}
                onChange={(e) => setXrayPort(e.target.value)}
                placeholder={defaults.xray_default_port || "41443"}
              />
              <p className="text-xs text-muted-foreground">
                {tn("xrayPortHint", xrayPortHintParams(xrayPort, defaults.xray_default_port))}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{ts("xrayTransport")}</Label>
              <Select value={xrayTransport} onValueChange={setXrayTransport}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reality">{ts("xrayTransportReality")}</SelectItem>
                  <SelectItem value="ws-tls">{ts("xrayTransportWsTls")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {xrayTransport === "reality" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="realityDest">{tn("realityTarget")}</Label>
                  <Input
                    id="realityDest"
                    value={realityDest}
                    onChange={(e) => setRealityDest(e.target.value)}
                    placeholder="www.microsoft.com:443"
                  />
                  <p className="text-xs text-muted-foreground">
                    {tn("realityTargetHint")}
                  </p>
                </div>
                {realityPublicKey && (
                  <>
                    <div className="space-y-2">
                      <Label>Reality Public Key</Label>
                      <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                        {realityPublicKey}
                      </code>
                    </div>
                    <div className="space-y-2">
                      <Label>Reality Short ID</Label>
                      <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                        {realityShortId}
                      </code>
                    </div>
                  </>
                )}
              </>
            )}
            {xrayTransport === "ws-tls" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="tlsDomain">{ts("tlsDomain")}</Label>
                  <Input
                    id="tlsDomain"
                    value={tlsDomain}
                    onChange={(e) => setTlsDomain(e.target.value)}
                    placeholder="vpn.example.com"
                  />
                  <p className="text-xs text-muted-foreground">{ts("tlsDomainHint")}</p>
                </div>
                <div className="space-y-2">
                  <Label>{ts("tlsCertMode")}</Label>
                  <Select value={tlsCertMode} onValueChange={(v: string) => setTlsCertMode(v as "auto" | "manual")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{ts("tlsCertModeAuto")}</SelectItem>
                      <SelectItem value="manual">{ts("tlsCertModeManual")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {tlsCertMode === "auto" && (
                    <p className="text-xs text-muted-foreground">{ts("tlsCertAutoHint")}</p>
                  )}
                </div>
                {tlsCertMode === "manual" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="tlsCert">{ts("tlsCert")}</Label>
                      <Textarea
                        id="tlsCert"
                        value={tlsCert}
                        onChange={(e) => setTlsCert(e.target.value)}
                        placeholder="-----BEGIN CERTIFICATE-----"
                        rows={4}
                        className="font-mono text-xs max-h-60 overflow-auto"
                      />
                      <p className="text-xs text-muted-foreground">{ts("tlsCertHint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tlsKey">{ts("tlsKey")}</Label>
                      <Textarea
                        id="tlsKey"
                        value={tlsKey}
                        onChange={(e) => setTlsKey(e.target.value)}
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        rows={4}
                        className="font-mono text-xs max-h-60 overflow-auto"
                      />
                      <p className="text-xs text-muted-foreground">{ts("tlsKeyHint")}</p>
                    </div>
                  </>
                )}
                {wsPath && (
                  <div className="space-y-2">
                    <Label>{ts("wsPath")}</Label>
                    <code className="block text-xs bg-muted px-3 py-2 rounded">{wsPath}</code>
                    <p className="text-xs text-muted-foreground">{ts("wsPathHint")}</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="remark">{tn("notes")}</Label>
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
          {saving ? tc("saving") : tc("save")}
        </Button>
        <Button variant="outline" onClick={() => router.push("/nodes")}>
          {tc("back")}
        </Button>
      </div>

      <NodeStatusChart nodeId={nodeId} />
      </>)}
    </div>
  );
}
