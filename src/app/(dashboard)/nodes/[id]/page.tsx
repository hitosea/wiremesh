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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusDot } from "@/components/status-dot";
import { NodeStatusChart } from "@/components/node-status-chart";
import { xrayPortHintParams } from "@/lib/port-hint";

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
  status: string;
  errorMessage: string | null;
  externalInterface: string;
  remark: string | null;
  agentVersion: string | null;
  xrayVersion: string | null;
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
      })
      .catch(() => toast.error(ts("loadNodeFailed")))
      .finally(() => setLoading(false));
    fetch("/api/settings").then(r => r.json()).then(j => setDefaults(j.data ?? {})).catch(() => {});
  }, [nodeId, router]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }

  if (!node) return null;

  return (
    <div className="space-y-6">
      <div className="w-full max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{node.name}</h1>
          <StatusDot status={node.status} label={ts(`status.${node.status}`)} />
        </div>
        <Button variant="outline" onClick={() => router.push("/nodes")}>
          {tc("back")}
        </Button>
      </div>
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
          {node.errorMessage && (
            <div className="space-y-2">
              <Label className="text-destructive">{t("errorMessage")}</Label>
              <p className="text-sm text-destructive">{node.errorMessage}</p>
            </div>
          )}
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
      </div>

      <NodeStatusChart nodeId={nodeId} />
    </div>
  );
}
