"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusDot } from "@/components/status-dot";
import { PageHeader } from "@/components/page-header";
import { NodeStatusChart } from "@/components/node-status-chart";
import { parseTunnelPortBlacklist } from "@/lib/ip-allocator";
import { NodePortsDetail } from "@/components/node-ports-detail";
import type { DeviceProtocol } from "@/lib/protocols";
import { useAdminSSE } from "@/components/admin-sse-provider";
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-context";
import { Loader2 } from "lucide-react";

type NodeDetail = {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  port: number;
  xrayBasePort: number | null;
  agentToken: string;
  wgPublicKey: string;
  wgAddress: string;
  status: string;
  errorMessage: string | null;
  externalInterface: string;
  remark: string | null;
  agentVersion: string | null;
  xrayVersion: string | null;
  tunnelPortBlacklist: string;
  ports: {
    wg: number;
    tunnels: number[];
    groups: { protocol: DeviceProtocol; ports: { lineId: number; port: number }[] }[];
  };
  protocols: {
    xrayReality: {
      realityDest: string;
      realityPublicKey: string;
      realityShortId: string;
    } | null;
    xrayWsTls: {
      tlsDomain: string;
      certMode: "auto" | "manual";
      wsPath: string;
      hasCert: boolean;
    } | null;
  } | null;
};

type BlockingDevice = { id: number; name: string; lineId: number };

function BlockingDevicesDialog({
  open,
  transport,
  devices,
  onClose,
  t,
}: {
  open: boolean;
  transport: string | null;
  devices: BlockingDevice[];
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogTitle>{t("xrayTransportInUseTitle")}</DialogTitle>
        <p className="text-sm text-muted-foreground mb-2">
          {t("xrayTransportInUseDescription", { transport: transport ?? "" })}
        </p>
        <ul className="space-y-1 text-sm">
          {devices.map((d) => (
            <li key={d.id}>
              <Link href={`/devices/${d.id}`} className="underline hover:no-underline">
                {d.name}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                ({t("inLine", { id: d.lineId })})
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

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
  const [xrayBasePort, setXrayBasePort] = useState("");
  const [remark, setRemark] = useState("");
  const [externalInterface, setExternalInterface] = useState("eth0");
  const [defaults, setDefaults] = useState<Record<string, string>>({});

  // Transport state
  const [realityEnabled, setRealityEnabled] = useState(false);
  const [wsTlsEnabled, setWsTlsEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<"xray-reality" | "xray-wstls">("xray-reality");

  // Reality fields
  const [realityDest, setRealityDest] = useState("");
  const [realityPublicKey, setRealityPublicKey] = useState("");
  const [realityShortId, setRealityShortId] = useState("");

  // WS+TLS fields
  const [tlsDomain, setTlsDomain] = useState("");
  const [tlsCertMode, setTlsCertMode] = useState<"auto" | "manual">("auto");
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");
  const [wsPath, setWsPath] = useState("");

  // Tunnel port blacklist
  const [blacklistInput, setBlacklistInput] = useState("");
  const [addingPort, setAddingPort] = useState(false);
  const [removingPort, setRemovingPort] = useState<number | null>(null);
  const blacklistBusy = addingPort || removingPort !== null;

  // Blocking devices dialog state
  const [blockingDevices, setBlockingDevices] = useState<BlockingDevice[]>([]);
  const [blockingTransport, setBlockingTransport] = useState<"xray-reality" | "xray-wstls" | null>(null);

  const blacklistPorts: number[] = node ? parseTunnelPortBlacklist(node.tunnelPortBlacklist) : [];

  // Only one transport can be removed if it's not the last one
  const canRemoveReality = wsTlsEnabled;
  const canRemoveWsTls = realityEnabled;

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
        setXrayBasePort(n.xrayBasePort != null ? String(n.xrayBasePort) : "");
        setRemark(n.remark ?? "");
        setExternalInterface(n.externalInterface ?? "eth0");

        const p = n.protocols ?? { xrayReality: null, xrayWsTls: null };
        setRealityEnabled(!!p.xrayReality);
        setWsTlsEnabled(!!p.xrayWsTls);
        setActiveTab(p.xrayReality ? "xray-reality" : "xray-wstls");

        if (p.xrayReality) {
          setRealityDest(p.xrayReality.realityDest ?? "");
          setRealityPublicKey(p.xrayReality.realityPublicKey ?? "");
          setRealityShortId(p.xrayReality.realityShortId ?? "");
        }
        if (p.xrayWsTls) {
          setTlsDomain(p.xrayWsTls.tlsDomain ?? "");
          setTlsCertMode(p.xrayWsTls.certMode ?? "auto");
          setWsPath(p.xrayWsTls.wsPath ?? "");
          // Server does not return cert/key content; hasCert just indicates they exist
        }
      })
      .catch(() => toast.error(ts("loadNodeFailed")))
      .finally(() => setLoading(false));
    fetch("/api/settings").then(r => r.json()).then(j => setDefaults(j.data ?? {})).catch(() => {});
  }, [nodeId, router, ts]);

  // SSE real-time updates for this node
  useAdminSSE("node_status", (update) => {
    if (update.nodeId === Number(nodeId)) {
      setNode((prev) => prev ? { ...prev, ...update, id: prev.id } as NodeDetail : prev);
    }
  });

  async function removeTransport(which: "xray-reality" | "xray-wstls") {
    const body = {
      protocols: {
        xrayReality: which === "xray-reality" ? null : undefined,
        xrayWsTls: which === "xray-wstls" ? null : undefined,
      },
    };
    const res = await fetch(`/api/nodes/${nodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      if (which === "xray-reality") {
        setRealityEnabled(false);
        setRealityDest("");
        setRealityPublicKey("");
        setRealityShortId("");
      }
      if (which === "xray-wstls") {
        setWsTlsEnabled(false);
        setTlsDomain("");
        setWsPath("");
      }
      if (activeTab === which) {
        setActiveTab(which === "xray-reality" ? "xray-wstls" : "xray-reality");
      }
      toast.success(tc("save"));
      return;
    }
    const err = await res.json();
    if (err.error?.code === "CONFLICT" && err.error?.message === "validation.xrayTransportInUse") {
      setBlockingDevices(err.details?.devices ?? []);
      setBlockingTransport(which);
    } else {
      toast.error(translateError(err.error, te, tc("saveFailed")));
    }
  }

  function addReality() {
    setRealityEnabled(true);
    setActiveTab("xray-reality");
  }

  function addWsTls() {
    setWsTlsEnabled(true);
    setActiveTab("xray-wstls");
  }

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
        xrayBasePort: xrayBasePort ? parseInt(xrayBasePort, 10) : null,
        remark: remark.trim() || null,
        externalInterface: externalInterface.trim() || "eth0",
        protocols: {
          xrayReality: realityEnabled
            ? { realityDest: realityDest }
            : null,
          xrayWsTls: wsTlsEnabled
            ? {
                tlsDomain: tlsDomain.trim(),
                certMode: tlsCertMode,
                tlsCert: tlsCertMode === "manual" ? tlsCert : undefined,
                tlsKey: tlsCertMode === "manual" ? tlsKey : undefined,
              }
            : null,
        },
      };

      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(tc("save"));
        setNode((prev) => (prev ? { ...prev, ...json.data } : json.data));
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
      <PageHeader
        title={
          node ? (
            node.name
          ) : (
            <span className="inline-block h-7 w-48 rounded-md bg-muted animate-pulse align-middle" />
          )
        }
        badge={node && <StatusDot status={node.status} label={ts(`status.${node.status}`)} />}
        actions={
          <Button variant="outline" onClick={() => router.push("/nodes")}>
            {tc("back")}
          </Button>
        }
      />
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
              <Label htmlFor="xrayBasePort">{tn("xrayStartPort")}</Label>
              <Input
                id="xrayBasePort"
                type="number"
                value={xrayBasePort}
                onChange={(e) => setXrayBasePort(e.target.value)}
                placeholder={defaults?.xray_default_port || "41443"}
              />
              <p className="text-xs text-muted-foreground">{tn("xrayPortHint")}</p>
            </div>
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "xray-reality" | "xray-wstls")}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <TabsList>
                  {realityEnabled && (
                    <TabsTrigger value="xray-reality" className="flex items-center gap-1">
                      {ts("xrayTransportReality")}
                      {canRemoveReality && (
                        <span
                          role="button"
                          tabIndex={0}
                          onPointerDown={(e) => { e.stopPropagation(); }}
                          onClick={(e) => { e.stopPropagation(); removeTransport("xray-reality"); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              removeTransport("xray-reality");
                            }
                          }}
                          className="ml-1 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 leading-none cursor-pointer inline-flex items-center"
                          aria-label="remove Reality"
                        >
                          ✕
                        </span>
                      )}
                    </TabsTrigger>
                  )}
                  {wsTlsEnabled && (
                    <TabsTrigger value="xray-wstls" className="flex items-center gap-1">
                      {ts("xrayTransportWsTls")}
                      {canRemoveWsTls && (
                        <span
                          role="button"
                          tabIndex={0}
                          onPointerDown={(e) => { e.stopPropagation(); }}
                          onClick={(e) => { e.stopPropagation(); removeTransport("xray-wstls"); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              removeTransport("xray-wstls");
                            }
                          }}
                          className="ml-1 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 leading-none cursor-pointer inline-flex items-center"
                          aria-label="remove WS+TLS"
                        >
                          ✕
                        </span>
                      )}
                    </TabsTrigger>
                  )}
                </TabsList>
                {!realityEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addReality}
                  >
                    + {ts("addReality")}
                  </Button>
                )}
                {!wsTlsEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addWsTls}
                  >
                    + {ts("addWsTls")}
                  </Button>
                )}
              </div>

              {realityEnabled && (
                <TabsContent value="xray-reality" className="space-y-4 pt-4">
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
                </TabsContent>
              )}

              {wsTlsEnabled && (
                <TabsContent value="xray-wstls" className="space-y-4 pt-4">
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
                </TabsContent>
              )}
            </Tabs>
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

      <BlockingDevicesDialog
        open={blockingTransport !== null}
        transport={blockingTransport}
        devices={blockingDevices}
        onClose={() => setBlockingTransport(null)}
        t={t}
      />
      </>)}
    </div>
  );
}
