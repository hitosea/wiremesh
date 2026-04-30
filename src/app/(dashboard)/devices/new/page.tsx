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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { DeviceProtocol } from "@/lib/protocols";

type LineOption = { id: number; name: string };

export default function NewDevicePage() {
  const t = useTranslations("deviceNew");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<DeviceProtocol>("wireguard");
  const [lineId, setLineId] = useState<string>("");
  const [remark, setRemark] = useState("");

  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [linesLoading, setLinesLoading] = useState(true);

  useEffect(() => {
    setLinesLoading(true);
    const url = `/api/lines?page=1&pageSize=100&supportsProtocol=${encodeURIComponent(protocol)}`;
    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        const opts = (json.data ?? []).map((l: LineOption) => ({ id: l.id, name: l.name }));
        setLineOptions(opts);
        // Drop the current selection if the protocol change made it invalid.
        setLineId((prev) => (prev && !opts.some((o: LineOption) => String(o.id) === prev) ? "" : prev));
      })
      .catch(() => {})
      .finally(() => setLinesLoading(false));
  }, [protocol]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!protocol) {
      toast.error(t("protocolRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          protocol,
          lineId: lineId ? parseInt(lineId) : null,
          remark: remark.trim() || null,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        toast.success(t("created"));
        router.push("/devices");
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
                {t("deviceName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("deviceNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="protocol">
                {t("protocolType")} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={protocol}
                onValueChange={(v) => setProtocol(v as DeviceProtocol)}
              >
                <SelectTrigger id="protocol">
                  <SelectValue placeholder={t("selectProtocol")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wireguard">WireGuard</SelectItem>
                  <SelectItem value="xray-reality">{t("protocol.xrayReality")}</SelectItem>
                  <SelectItem value="xray-wstls">{t("protocol.xrayWsTls")}</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lineId">{t("line")}</Label>
              <div className="flex">
                <div className="flex items-center gap-2">
                  <Select
                    value={lineId}
                    onValueChange={setLineId}
                    disabled={linesLoading || lineOptions.length === 0}
                  >
                    <SelectTrigger id="lineId" className="flex-1">
                      <SelectValue
                        placeholder={linesLoading ? t("loadingLines") : t("selectLine")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("noLine")}</SelectItem>
                      {lineOptions.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {linesLoading && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />
                  )}
                </div>
              </div>
              {!linesLoading && lineOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("noLines")}
                  <Link href="/lines/new" className="text-primary hover:underline">{t("createLine")}</Link>
                </p>
              )}
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

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? tc("creating") : t("createDevice")}
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
