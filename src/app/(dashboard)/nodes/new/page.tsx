"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
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
import { DEFAULT_REALITY_DEST } from "@/lib/reality-dest";

export default function NewNodePage() {
  const router = useRouter();
  const t = useTranslations("nodeNew");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const ts = useTranslations("nodes");
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");
  const [xrayBasePort, setXrayBasePort] = useState("");
  const [remark, setRemark] = useState("");
  const [externalInterface, setExternalInterface] = useState("eth0");

  // Transport state
  const [realityEnabled, setRealityEnabled] = useState(true);
  const [wsTlsEnabled, setWsTlsEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<"xray-reality" | "xray-wstls">("xray-reality");

  // Reality fields
  const [realityDest, setRealityDest] = useState(DEFAULT_REALITY_DEST);

  // WS+TLS fields
  const [tlsDomain, setTlsDomain] = useState("");
  const [tlsCertMode, setTlsCertMode] = useState<"auto" | "manual">("auto");
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");

  const [defaults, setDefaults] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(j => setDefaults(j.data ?? {})).catch(() => {});
  }, []);

  // Only one transport can be disabled if it's not the last one
  const canRemoveReality = wsTlsEnabled;
  const canRemoveWsTls = realityEnabled;

  function addReality() {
    setRealityEnabled(true);
    setActiveTab("xray-reality");
  }

  function addWsTls() {
    setWsTlsEnabled(true);
    setActiveTab("xray-wstls");
  }

  function removeReality() {
    if (!canRemoveReality) return;
    setRealityEnabled(false);
    setActiveTab("xray-wstls");
  }

  function removeWsTls() {
    if (!canRemoveWsTls) return;
    setWsTlsEnabled(false);
    setActiveTab("xray-reality");
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!ip.trim()) {
      toast.error(t("ipRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        ip: ip.trim(),
        domain: domain.trim() || null,
        port: port ? parseInt(port) : undefined,
        xrayBasePort: xrayBasePort ? parseInt(xrayBasePort, 10) : undefined,
        remark: remark.trim() || null,
        externalInterface: externalInterface.trim() || "eth0",
        protocols: {
          xrayReality: realityEnabled ? { realityDest: realityDest || undefined } : undefined,
          xrayWsTls: wsTlsEnabled
            ? {
                tlsDomain: tlsDomain.trim(),
                certMode: tlsCertMode,
                tlsCert: tlsCertMode === "manual" ? tlsCert : undefined,
                tlsKey: tlsCertMode === "manual" ? tlsKey : undefined,
              }
            : undefined,
        },
      };

      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (res.ok) {
        toast.success(t("created"));
        router.push("/nodes");
      } else {
        toast.error(translateError(json.error, te, tc("createFailed")));
      }
    } catch {
      toast.error(tc("createFailedRetry"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <PageHeader
        title={t("title")}
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            {tc("back")}
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("basicInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                {t("nodeName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("nodeNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ip">
                {t("ipAddress")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ip"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder={t("ipPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">{t("domain")}</Label>
              <Input
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={t("domainPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("domainHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">{t("wgPort")}</Label>
              <Input
                id="port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder={defaults.wg_default_port || "41820"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="externalInterface">{t("externalInterface")}</Label>
              <Input
                id="externalInterface"
                value={externalInterface}
                onChange={(e) => setExternalInterface(e.target.value)}
                placeholder="eth0"
              />
              <p className="text-xs text-muted-foreground">
                {t("externalInterfaceHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="remark">{t("notes")}</Label>
              <Textarea
                id="remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("notesPlaceholder")}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("xraySettings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="xrayBasePort">{t("xrayStartPort")}</Label>
              <Input
                id="xrayBasePort"
                type="number"
                value={xrayBasePort}
                onChange={(e) => setXrayBasePort(e.target.value)}
                placeholder={defaults?.xray_default_port || "41443"}
              />
              <p className="text-xs text-muted-foreground">{t("xrayPortHint")}</p>
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
                          onClick={(e) => { e.stopPropagation(); removeReality(); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              removeReality();
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
                          onClick={(e) => { e.stopPropagation(); removeWsTls(); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              removeWsTls();
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
                <TabsContent value="xray-reality" className="space-y-2 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="realityDest">{t("realityTarget")}</Label>
                    <Input
                      id="realityDest"
                      value={realityDest}
                      onChange={(e) => setRealityDest(e.target.value)}
                      placeholder="www.microsoft.com:443"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("realityTargetHint")}
                    </p>
                  </div>
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
                    <Select
                      value={tlsCertMode}
                      onValueChange={(v: string) =>
                        setTlsCertMode(v as "auto" | "manual")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? tc("creating") : t("createNode")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            {tc("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
