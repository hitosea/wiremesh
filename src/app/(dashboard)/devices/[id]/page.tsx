"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
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
  tags: string | null;
  remark: string | null;
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
  const searchParams = useSearchParams();
  const deviceId = params.id as string;
  const from = searchParams.get("from");
  const backPath = from === "config" ? `/devices/${deviceId}/config` : "/devices";

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
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
        setTags(d.tags ?? "");
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
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ? te(json.error.message, json.error.params) : tc("saveFailed"));
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
          toast.error(lineJson.error?.message ? te(lineJson.error.message, lineJson.error.params) : t("updateLineFailed"));
          return;
        }
      }

      toast.success(t("saved"));
      setDevice({ ...json.data, lineId: parsedLineId });
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
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          {device.status !== "-" && (
            <StatusDot status={device.status} label={ts(`status.${device.status}`)} />
          )}
        </div>
        <Button variant="outline" onClick={() => router.push(backPath)}>
          {tc("back")}
        </Button>
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
            <Label htmlFor="tags">{tn("tagsComma")}</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={tn("tagsPlaceholder")}
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
        <Button variant="outline" onClick={() => router.push(backPath)}>
          {tc("back")}
        </Button>
      </div>
    </div>
  );
}
