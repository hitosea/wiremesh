"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { formatBytes } from "@/lib/format-bytes";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Pencil, Check, X, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Checkbox } from "@/components/ui/checkbox";

type LineNode = {
  hopOrder: number;
  role: string;
  nodeId: number;
  nodeName: string;
  nodeStatus: string;
};

type LineTunnel = {
  id: number;
  hopIndex: number;
  fromNodeId: number;
  fromNodeName: string;
  toNodeId: number;
  toNodeName: string;
  fromWgPublicKey: string;
  fromWgAddress: string;
  fromWgPort: number;
  toWgPublicKey: string;
  toWgAddress: string;
  toWgPort: number;
};

type TunnelStatusView = {
  id: number; lineId: number; hopIndex: number;
  fromNodeId: number; fromNodeName: string;
  toNodeId: number; toNodeName: string;
  fromWgAddress: string; toWgAddress: string;
  fromWgPort: number; toWgPort: number;
  lastHandshake: number; rxBytes: number; txBytes: number;
  dataFromToNode: boolean; stale: boolean;
  fromNodeReachable: boolean; toNodeReachable: boolean;
};

type BranchFilter = {
  filterId: number;
  filterName: string;
};

type Branch = {
  id: number;
  name: string;
  isDefault: boolean;
  nodes: LineNode[];
  filters: BranchFilter[];
};

type LineDetail = {
  id: number;
  name: string;
  status: string;
  remark: string | null;
  nodes: LineNode[];
  tunnels: LineTunnel[];
  branches: Branch[];
  deviceCount: number;
};

export default function LineDetailPage() {
  const router = useRouter();
  const params = useParams();
  const lineId = params.id as string;
  const t = useTranslations("lineDetail");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const tn = useTranslations("nodes");
  const tl = useTranslations("lines");
  const tNew = useTranslations("lineNew");

  const [line, setLine] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");

  const [tunnelStatus, setTunnelStatus] = useState<{
    lastReportedAt: number | null;
    tunnels: TunnelStatusView[];
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [branchNameDraft, setBranchNameDraft] = useState("");
  const [branchSaving, setBranchSaving] = useState(false);

  const [reallocateTarget, setReallocateTarget] = useState<{
    tunnelId: number;
    fromPort: number;
    toPort: number;
  } | null>(null);
  const [reallocateBlacklist, setReallocateBlacklist] = useState(true);
  const [reallocating, setReallocating] = useState(false);

  const startEditBranch = (branch: Branch) => {
    setEditingBranchId(branch.id);
    setBranchNameDraft(branch.name);
  };

  const cancelEditBranch = () => {
    setEditingBranchId(null);
    setBranchNameDraft("");
  };

  const saveBranchName = async (branchId: number) => {
    const trimmed = branchNameDraft.trim();
    if (!trimmed) {
      toast.error(t("branchNameEmpty"));
      return;
    }
    setBranchSaving(true);
    try {
      const res = await fetch(
        `/api/lines/${lineId}/branches/${branchId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        }
      );
      const json = await res.json();
      if (res.ok) {
        toast.success(t("branchRenamed"));
        setLine((prev) =>
          prev
            ? {
                ...prev,
                branches: prev.branches.map((b) =>
                  b.id === branchId ? { ...b, name: trimmed } : b
                ),
              }
            : prev
        );
        setEditingBranchId(null);
        setBranchNameDraft("");
      } else {
        toast.error(translateError(json.error, te, tc("saveFailed")));
      }
    } catch {
      toast.error(tc("saveFailedRetry"));
    } finally {
      setBranchSaving(false);
    }
  };

  useEffect(() => {
    fetch(`/api/lines/${lineId}`)
      .then((res) => res.json())
      .then((json) => {
        const l = json.data;
        if (!l) {
          toast.error(t("notFound"));
          router.push("/lines");
          return;
        }
        setLine(l);
        setName(l.name ?? "");
        setRemark(l.remark ?? "");
      })
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [lineId, router]);

  const loadStatus = useCallback(async () => {
    if (!line) return;
    const r = await fetch(`/api/lines/${line.id}/tunnels`);
    if (r.ok) setTunnelStatus(await r.json());
  }, [line?.id]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleRefresh = async () => {
    if (!line) return;
    setRefreshing(true);
    try {
      const r = await fetch(`/api/lines/${line.id}/tunnels/refresh`, { method: "POST" });
      if (r.ok) {
        setTunnelStatus(await r.json());
        toast.success(t("refreshed"));
      } else {
        toast.error(t("refreshFailed"));
      }
    } finally {
      setRefreshing(false);
    }
  };

  const openReallocate = (tunnelId: number, fromPort: number, toPort: number) => {
    setReallocateTarget({ tunnelId, fromPort, toPort });
    setReallocateBlacklist(true);
  };

  const confirmReallocate = async () => {
    if (!reallocateTarget) return;
    setReallocating(true);
    try {
      const r = await fetch(`/api/line-tunnels/${reallocateTarget.tunnelId}/reallocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addToBlacklist: reallocateBlacklist }),
      });
      if (r.ok) {
        const data = await r.json();
        toast.success(t("reallocateSuccess", { ports: `${data.newPorts.from}/${data.newPorts.to}` }));
        location.reload();
      } else {
        toast.error(t("reallocateFailed"));
      }
    } finally {
      setReallocating(false);
      setReallocateTarget(null);
    }
  };

  const formatHandshake = (unixSec: number): string => {
    if (unixSec === 0) return t("never");
    const ago = Math.floor(Date.now() / 1000) - unixSec;
    if (ago < 60) return t("secondsAgo", { n: ago });
    if (ago < 3600) return t("minutesAgo", { n: Math.floor(ago / 60) });
    if (ago < 86400) return t("hoursAgo", { n: Math.floor(ago / 3600) });
    return t("daysAgo", { n: Math.floor(ago / 86400) });
  };
  const formatTime = (unixSec: number): string => {
    return new Date(unixSec * 1000).toLocaleTimeString();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/lines/${lineId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(t("saved"));
        setLine((prev) => (prev ? { ...prev, ...json.data } : prev));
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

  if (!line) return null;

  return (
    <div className="space-y-6 w-full max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{line.name}</h1>
          <StatusDot status={line.status} label={tl(`status.${line.status}` as "status.active" | "status.inactive") ?? line.status} />
        </div>
        <Button variant="outline" onClick={() => router.push("/lines")}>
          {tc("back")}
        </Button>
      </div>

      {/* Basic info card */}
      {(() => {
        const entryNode = line.nodes.find((n) => n.role === "entry");
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t("basicInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground w-20 shrink-0">{t("name")}</span>
                <span>{line.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground w-20 shrink-0">{t("entryNode")}</span>
                {entryNode ? (
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/nodes/${entryNode.nodeId}`}
                      className="text-primary hover:underline"
                    >
                      {entryNode.nodeName}
                    </Link>
                    <StatusDot status={entryNode.nodeStatus} label={tn(`status.${entryNode.nodeStatus}` as "status.online" | "status.offline" | "status.installing" | "status.error") ?? entryNode.nodeStatus} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("notSet")}</span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Branch topology */}
      <Card>
        <CardHeader>
          <CardTitle>{t("branchTopology")}</CardTitle>
        </CardHeader>
        <CardContent>
          {line.branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noBranches")}</p>
          ) : (
            <div className="space-y-3">
              {line.branches.map((branch) => {
                const entryNode = line.nodes.find((n) => n.role === "entry");
                const branchNodeNames = branch.nodes
                  .sort((a, b) => a.hopOrder - b.hopOrder)
                  .map((n) => n.nodeName);
                const chainParts = entryNode
                  ? [entryNode.nodeName, ...branchNodeNames]
                  : branchNodeNames;
                const isSingleNode = branchNodeNames.length === 0;
                const chainStr = isSingleNode
                  ? `${chainParts[0]} (${t("directExit")})`
                  : chainParts.join(" \u2192 ");

                return (
                  <div
                    key={branch.id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      {editingBranchId === branch.id ? (
                        <>
                          <Input
                            value={branchNameDraft}
                            onChange={(e) => setBranchNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                saveBranchName(branch.id);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditBranch();
                              }
                            }}
                            disabled={branchSaving}
                            autoFocus
                            className="h-8 max-w-xs"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => saveBranchName(branch.id)}
                            disabled={branchSaving}
                            aria-label={tc("save")}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={cancelEditBranch}
                            disabled={branchSaving}
                            aria-label={tc("cancel")}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center h-8">
                            <span className="font-medium">{branch.name}</span>
                          </div>
                          {branch.isDefault && (
                            <Badge variant="outline">{t("default")}</Badge>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => startEditBranch(branch)}
                            aria-label={t("renameBranch")}
                          >
                            <Pencil className="h-4 w-4 scale-90" />
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="text-sm font-mono text-muted-foreground">
                      {chainStr || tc("noData")}
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground">{t("filterRules")}</span>
                      {branch.filters.length === 0 ? (
                        <span className="text-muted-foreground">{t("noFilters")}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {branch.filters.map((f) => (
                            <Badge key={f.filterId} variant="secondary">
                              {f.filterName}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tunnel info card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{t("tunnelInfo")}</CardTitle>
          <div className="flex items-center gap-3">
            {tunnelStatus?.lastReportedAt && (
              <span className="text-xs text-muted-foreground">
                {t("lastUpdated", { time: formatTime(tunnelStatus.lastReportedAt) })}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing || tunnelStatus === null ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {line.tunnels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTunnels")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("segment")}</TableHead>
                  <TableHead>{t("sourceNode")}</TableHead>
                  <TableHead>{t("targetNode")}</TableHead>
                  <TableHead>{t("sourceAddress")}</TableHead>
                  <TableHead>{t("targetAddress")}</TableHead>
                  <TableHead>{t("sourcePort")}</TableHead>
                  <TableHead>{t("targetPort")}</TableHead>
                  <TableHead>{t("lastHandshake")}</TableHead>
                  <TableHead>{t("transfer")}</TableHead>
                  <TableHead>{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {line.tunnels.map((tun) => {
                  const status = tunnelStatus?.tunnels.find((s) => s.id === tun.id);
                  const lastHs = status?.lastHandshake ?? 0;
                  const rx = status?.rxBytes ?? 0;
                  const tx = status?.txBytes ?? 0;
                  const stale = status?.stale ?? false;
                  const offline = !!status && !status.fromNodeReachable && !status.toNodeReachable;
                  const initialLoading = tunnelStatus === null;

                  return (
                    <TableRow key={tun.id}>
                      <TableCell>{tun.hopIndex + 1}</TableCell>
                      <TableCell>{tun.fromNodeName}</TableCell>
                      <TableCell>{tun.toNodeName}</TableCell>
                      <TableCell><code className="text-xs">{tun.fromWgAddress}</code></TableCell>
                      <TableCell><code className="text-xs">{tun.toWgAddress}</code></TableCell>
                      <TableCell>{tun.fromWgPort}</TableCell>
                      <TableCell>{tun.toWgPort}</TableCell>
                      <TableCell className={stale ? "text-muted-foreground" : ""}>
                        {initialLoading ? (
                          <span className="inline-block h-3 w-16 rounded bg-muted animate-pulse align-middle" />
                        ) : offline ? "—" : formatHandshake(lastHs)}
                        {!initialLoading && stale && !offline && (
                          <span title={t("staleData")} className="ml-1 opacity-50">ⓘ</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {initialLoading ? (
                          <span className="inline-block h-3 w-20 rounded bg-muted animate-pulse align-middle" />
                        ) : offline ? "—" : `↓${formatBytes(rx)} ↑${formatBytes(tx)}`}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openReallocate(tun.id, tun.fromWgPort, tun.toWgPort)}
                        >
                          {t("reallocate")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Associated devices */}
      <Card>
        <CardHeader>
          <CardTitle>{t("relatedDevices")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("deviceCount")}{" "}
            <Link
              href={`/devices?lineId=${line.id}`}
              className="text-primary hover:underline font-medium"
            >
              {line.deviceCount} {t("deviceUnit")}
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader>
          <CardTitle>{t("editLine")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {t("lineName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remark">{tNew("notes")}</Label>
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
        <Button variant="outline" onClick={() => router.push("/lines")}>
          {tc("back")}
        </Button>
      </div>

      <AlertDialog
        open={reallocateTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reallocating) setReallocateTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reallocateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {reallocateTarget &&
                t("reallocateDescription", {
                  ports: `${reallocateTarget.fromPort}/${reallocateTarget.toPort}`,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reallocateTarget && (
            <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <Checkbox
                checked={reallocateBlacklist}
                onCheckedChange={(v) => setReallocateBlacklist(v === true)}
                className="mt-0.5"
              />
              <span>
                {t("reallocateAddToBlacklist", {
                  ports: `${reallocateTarget.fromPort}/${reallocateTarget.toPort}`,
                })}
              </span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reallocating}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={reallocating}
              onClick={(e) => {
                e.preventDefault();
                confirmReallocate();
              }}
            >
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
