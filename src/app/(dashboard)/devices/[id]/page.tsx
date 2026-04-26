"use client";

import { Suspense, useEffect, useState } from "react";
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
import { StatusDotWithCount } from "@/components/status-dot-with-count";
import { formatBytes } from "@/lib/format-bytes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";

type LineOption = { id: number; name: string };

type DeviceDetail = {
  id: number;
  name: string;
  protocol: string;
  wgPublicKey: string | null;
  wgAddress: string | null;
  xrayUuid: string | null;
  xrayConfig: string | null;
  lineId: number | null;
  status: string;
  lastHandshake: string | null;
  remark: string | null;
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
  activeIps: string | null;
};

export default function DeviceDetailPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground">{tc("loading")}</div>}>
      <DeviceDetailContent />
    </Suspense>
  );
}

function DeviceDetailContent() {
  const t = useTranslations("deviceDetail");
  const ts = useTranslations("devices");
  const tn = useTranslations("deviceNew");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const params = useParams();
  const deviceId = params.id as string;

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [lineId, setLineId] = useState("");
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);

  useEffect(() => {
    fetch("/api/lines?page=1&pageSize=100")
      .then((res) => res.json())
      .then((json) => setLineOptions((json.data ?? []).map((l: LineOption) => ({ id: l.id, name: l.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/devices/${deviceId}`)
      .then((res) => res.json())
      .then((json) => {
        const d = json.data;
        if (!d) {
          toast.error(t("notFound"));
          router.push("/devices");
          return;
        }
        setDevice(d);
        setName(d.name ?? "");
        setRemark(d.remark ?? "");
        setLineId(d.lineId ? String(d.lineId) : "");
      })
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [deviceId, router]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(translateError(json.error, te, tc("saveFailed")));
        return;
      }

      // Update line assignment if changed
      const parsedLineId = lineId ? parseInt(lineId) : null;
      if (parsedLineId !== device?.lineId) {
        const lineRes = await fetch(`/api/devices/${deviceId}/line`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineId: parsedLineId }),
        });
        const lineJson = await lineRes.json();
        if (!lineRes.ok) {
          toast.error(translateError(lineJson.error, te, t("updateLineFailed")));
          return;
        }
      }

      toast.success(t("saved"));
      setDevice((prev) =>
        prev
          ? { ...prev, name: name.trim(), remark: remark.trim() || null, lineId: parsedLineId }
          : prev,
      );
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

  if (!device) return null;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          {device.status !== "-" && (
            <StatusDotWithCount
              status={device.status}
              label={ts(`status.${device.status}`)}
              count={device.connectionCount}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push(`/devices/${deviceId}/config`)}>
            {ts("config")}
          </Button>
          <Button variant="outline" onClick={() => router.push("/devices")}>
            {tc("back")}
          </Button>
        </div>
      </div>

      {/* Read-only info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("deviceInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("protocol")}</Label>
            <p className="text-sm font-medium">
              {ts(`protocol.${device.protocol}`)}
            </p>
          </div>
          {device.protocol === "wireguard" && (
            <>
              <div className="space-y-2">
                <Label>{t("wgInternalAddress")}</Label>
                <p className="text-sm font-medium">{device.wgAddress ?? "—"}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("wgPublicKey")}</Label>
                <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                  {device.wgPublicKey ?? "—"}
                </code>
              </div>
            </>
          )}
          {device.protocol === "xray" && (
            <div className="space-y-2">
              <Label>{t("xrayUuid")}</Label>
              <code className="block text-xs bg-muted px-3 py-2 rounded break-all">
                {device.xrayUuid ?? "—"}
              </code>
            </div>
          )}
          {device.lastHandshake && (
            <div className="space-y-2">
              <Label>{t("lastHandshake")}</Label>
              <p className="text-sm text-muted-foreground">
                {device.lastHandshake}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Traffic stats */}
      <Card>
        <CardHeader>
          <CardTitle>{t("trafficStats")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">{t("cumulativeUpload")}</div>
            <div className="text-2xl font-semibold">{formatBytes(device.uploadBytes)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">{t("cumulativeDownload")}</div>
            <div className="text-2xl font-semibold">{formatBytes(device.downloadBytes)}</div>
          </div>
        </CardContent>
      </Card>

      {/* Active connections (Xray only) */}
      {device.protocol === "xray" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("activeConnections")}</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const ips: { ip: string; last_seen: number }[] = device.activeIps
                ? JSON.parse(device.activeIps)
                : [];
              if (ips.length === 0) {
                return <div className="text-sm text-muted-foreground">{t("noActiveConnections")}</div>;
              }
              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 font-medium">{t("sourceIp")}</th>
                      <th className="py-1 font-medium">{t("lastSeen")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ips.map((entry) => (
                      <tr key={entry.ip} className={ips.length > 1 ? "border-t" : ""}>
                        <td className="py-1 font-mono">{entry.ip}</td>
                        <td className="py-1">{new Date(entry.last_seen * 1000).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Edit form */}
      <Card>
        <CardHeader>
          <CardTitle>{t("editDevice")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {ts("name")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
          <div className="space-y-2">
            <Label htmlFor="lineId">{tn("line")}</Label>
            {lineOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tn("noLines")}<Link href="/lines/new" className="text-primary hover:underline">{tn("createLine")}</Link>
              </p>
            ) : (
              <Select value={lineId || "none"} onValueChange={(v) => setLineId(v === "none" ? "" : v)}>
                <SelectTrigger id="lineId">
                  <SelectValue placeholder={tn("selectLine")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tn("noLine")}</SelectItem>
                  {lineOptions.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? tc("saving") : tc("save")}
        </Button>
        <Button variant="outline" onClick={() => router.push("/devices")}>
          {tc("back")}
        </Button>
      </div>
    </div>
  );
}
