"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePublicUrlCheck } from "@/components/public-url-check-provider";
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-context";
import { ALL_CLIENT_IDS, CLIENT_TO_FORMAT, FORMAT_PROTOCOL_SUPPORT, clientI18nKey, type ClientId } from "@/lib/subscription/formats";

type DeviceRow = {
  id: number;
  name: string;
  protocol: string;
  status: string;
  lineId: number | null;
};

type LineRow = { id: number; name: string };

type GroupDetail = {
  id: number;
  name: string;
  token: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  devices: DeviceRow[];
};

export default function SubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const { publicUrl } = usePublicUrlCheck();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [savingBasic, setSavingBasic] = useState(false);

  const [allDevices, setAllDevices] = useState<DeviceRow[]>([]);
  const [allLines, setAllLines] = useState<LineRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [savingDevices, setSavingDevices] = useState(false);

  const [showQrFor, setShowQrFor] = useState<ClientId | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);

  useSetBreadcrumbLabel(group?.name ?? null);

  const baseOrigin = useMemo(() => {
    if (publicUrl) return publicUrl;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }, [publicUrl]);

  const wgDeviceCount = useMemo(
    () => (group?.devices ?? []).filter((d) => d.protocol === "wireguard").length,
    [group]
  );
  const clientUrl = (clientId: ClientId): string =>
    group ? `${baseOrigin}/api/sub/${group.token}/${clientId}` : "";

  const fetchGroup = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/subscriptions/${groupId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(translateError(json.error, te, t("loadFailed")));
      const data = json.data as GroupDetail;
      setGroup(data);
      setName(data.name);
      setRemark(data.remark ?? "");
      setSelectedIds(new Set(data.devices.map((d) => d.id)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const fetchSidebarData = async () => {
    try {
      const [devRes, lineRes] = await Promise.all([
        fetch("/api/devices?page=1&pageSize=500"),
        fetch("/api/lines?page=1&pageSize=200"),
      ]);
      const devJson = await devRes.json();
      const lineJson = await lineRes.json();
      setAllDevices(devJson.data ?? []);
      setAllLines(lineJson.data ?? []);
    } catch {
      // non-fatal — selector just shows empty list
    }
  };

  useEffect(() => {
    fetchGroup();
    fetchSidebarData();
  }, [groupId]);

  const lineNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of allLines) m.set(l.id, l.name);
    return m;
  }, [allLines]);

  const handleSaveBasic = async () => {
    if (!name.trim()) {
      toast.error(te("validation.nameRequired"));
      return;
    }
    setSavingBasic(true);
    try {
      const res = await fetch(`/api/subscriptions/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), remark: remark.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(translateError(json.error, te, t("saveFailed")));
      toast.success(t("saved"));
      await fetchGroup();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavingBasic(false);
    }
  };

  const handleSaveDevices = async () => {
    setSavingDevices(true);
    try {
      const res = await fetch(`/api/subscriptions/${groupId}/devices`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceIds: Array.from(selectedIds) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(translateError(json.error, te, t("saveDevicesFailed")));
      toast.success(t("savedDevices"));
      await fetchGroup();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveDevicesFailed"));
    } finally {
      setSavingDevices(false);
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      const res = await fetch(`/api/subscriptions/${groupId}/rotate-token`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(translateError(json.error, te, t("rotateFailed")));
      toast.success(t("rotated"));
      setRotateOpen(false);
      await fetchGroup();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("rotateFailed"));
    } finally {
      setRotating(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const toggleDevice = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold truncate">
            {loading ? (
              <span className="inline-block h-7 w-48 rounded-md bg-muted animate-pulse align-middle" />
            ) : (
              group?.name ?? t("title")
            )}
          </h1>
          {group?.remark && (
            <p className="text-sm text-muted-foreground mt-1 truncate">{group.remark}</p>
          )}
        </div>
        <Button variant="outline" onClick={() => router.push("/devices?tab=subscriptions")}>
          {tc("back")}
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          {tc("loading")}
        </div>
      ) : group && (<>

      <Tabs defaultValue="urls">
        <TabsList>
          <TabsTrigger value="urls" className="px-4">{t("tabUrls")}</TabsTrigger>
          <TabsTrigger value="devices" className="px-4">
            {t("tabDevices")} ({selectedIds.size})
          </TabsTrigger>
          <TabsTrigger value="basic" className="px-4">{t("tabBasic")}</TabsTrigger>
        </TabsList>

        <TabsContent value="urls" className="space-y-4 mt-4">
          {!publicUrl && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              {t("publicUrlMissing")}
            </div>
          )}
          {ALL_CLIENT_IDS.map((clientId) => {
            const url = clientUrl(clientId);
            const format = CLIENT_TO_FORMAT[clientId];
            const wgSupported = FORMAT_PROTOCOL_SUPPORT[format].wireguard;
            const showWgWarn = !wgSupported && wgDeviceCount > 0;
            // Only Clash and Sing-box subscriptions ship embedded routing
            // rules; URI-list formats (SR, V2Ray-family) carry no rules
            // and the client decides routing entirely on its own.
            const carriesRoutingRules = format === "clash" || format === "singbox";
            const i18nId = clientI18nKey(clientId);
            return (
              <Card key={clientId}>
                <CardHeader className="pb-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <CardTitle className="text-base">
                      {t(`clients.${i18nId}.name`)}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {t(`clients.${i18nId}.platforms`)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t(`clients.${i18nId}.note`)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {showWgWarn && (
                    <div className="rounded border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-100">
                      {t("wgSkippedWarning", { count: wgDeviceCount })}
                    </div>
                  )}
                  <div className="font-mono text-xs break-all bg-muted rounded p-2">{url}</div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => handleCopy(url)}>
                      {t("copyUrl")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowQrFor(showQrFor === clientId ? null : clientId)}
                    >
                      {showQrFor === clientId ? t("hideQr") : t("showQr")}
                    </Button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                    >
                      {tc("download")}
                    </a>
                  </div>
                  {showQrFor === clientId && (
                    <div className="flex justify-center bg-white p-4 rounded">
                      <QRCodeSVG value={url} size={200} />
                    </div>
                  )}
                  {carriesRoutingRules && (
                    <div className="-mx-6 px-6 mt-5 pt-4 border-t">
                      <p className="text-xs text-muted-foreground">
                        {t(`routingNote.${format}` as "routingNote.clash" | "routingNote.singbox")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("tokenLabel")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{t("tokenDesc")}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="font-mono text-xs break-all bg-muted rounded p-2">
                {group.token}
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setRotateOpen(true)}
              >
                {t("rotateToken")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("deviceSelectTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {allDevices.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t("deviceSelectEmpty")}</div>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto">
                  {allDevices.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-3 p-2 rounded hover:bg-accent/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.has(d.id)}
                        onCheckedChange={(c) => toggleDevice(d.id, c === true)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{d.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.protocol} · {d.lineId ? lineNameById.get(d.lineId) ?? `#${d.lineId}` : t("noLine")}
                        </div>
                      </div>
                      <Badge variant={d.status === "online" ? "default" : "secondary"}>
                        {d.status}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t("deviceTotal", { count: selectedIds.size })}
            </span>
            <Button onClick={handleSaveDevices} disabled={savingDevices}>
              {savingDevices ? tc("saving") : t("saveDevices")}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="basic" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("name")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={savingBasic}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remark">{t("remark")}</Label>
                <Textarea
                  id="remark"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  disabled={savingBasic}
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveBasic} disabled={savingBasic}>
                  {savingBasic ? tc("saving") : tc("save")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={rotateOpen} onOpenChange={(o) => !rotating && setRotateOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rotateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rotateConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={rotating}
              onClick={(e) => {
                e.preventDefault();
                handleRotate();
              }}
            >
              {rotating ? tc("saving") : t("rotateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>)}
    </div>
  );
}
