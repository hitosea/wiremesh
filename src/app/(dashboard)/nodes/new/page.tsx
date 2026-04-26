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
import { DEFAULT_REALITY_DEST } from "@/lib/reality-dest";
import { xrayPortHintParams } from "@/lib/port-hint";

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
  const [remark, setRemark] = useState("");
  const [externalInterface, setExternalInterface] = useState("eth0");
  const [xrayPort, setXrayPort] = useState("");
  const [realityDest, setRealityDest] = useState(DEFAULT_REALITY_DEST);
  const [xrayTransport, setXrayTransport] = useState<"reality" | "ws-tls">("reality");
  const [tlsDomain, setTlsDomain] = useState("");
  const [tlsCertMode, setTlsCertMode] = useState<"auto" | "manual">("auto");
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");
  const [defaults, setDefaults] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(j => setDefaults(j.data ?? {})).catch(() => {});
  }, []);

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
        remark: remark.trim() || null,
        externalInterface: externalInterface.trim() || "eth0",
        xrayPort: xrayPort ? parseInt(xrayPort) : null,
        xrayTransport,
      };

      if (xrayTransport === "reality") {
        body.realityDest = realityDest || undefined;
      } else {
        body.xrayTlsDomain = tlsDomain.trim();
        if (tlsCertMode === "manual") {
          body.xrayTlsCert = tlsCert;
          body.xrayTlsKey = tlsKey;
        }
      }

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={() => router.back()}>
          {tc("back")}
        </Button>
      </div>

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
              <Label htmlFor="xrayPort">{t("xrayStartPort")}</Label>
              <Input
                id="xrayPort"
                type="number"
                value={xrayPort}
                onChange={(e) => setXrayPort(e.target.value)}
                placeholder={defaults.xray_default_port || "41443"}
              />
              <p className="text-xs text-muted-foreground">
                {t("xrayPortHint", xrayPortHintParams(xrayPort, defaults.xray_default_port))}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{ts("xrayTransport")}</Label>
              <Select
                value={xrayTransport}
                onValueChange={(v: string) =>
                  setXrayTransport(v as "reality" | "ws-tls")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reality">{ts("xrayTransportReality")}</SelectItem>
                  <SelectItem value="ws-tls">{ts("xrayTransportWsTls")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {xrayTransport === "reality" && (
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
              </>
            )}
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
