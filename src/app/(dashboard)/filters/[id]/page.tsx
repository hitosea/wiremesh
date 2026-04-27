"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FilterFormatHelp } from "@/components/filter-format-help";
import { useAdminSSE } from "@/components/admin-sse-provider";
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-context";
import { PageHeader } from "@/components/page-header";
import { buildBranchChain, type LineNode } from "@/lib/branch-chain";

type Branch = {
  id: number;
  name: string;
  isDefault: boolean;
};

type LineWithBranches = {
  id: number;
  name: string;
  branches?: Branch[];
  nodes?: LineNode[];
};

type FilterDetail = {
  id: number;
  name: string;
  rules: string;
  domainRules: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  sourceSyncStatus: "ok" | "error" | null;
  sourceLastError: string | null;
  sourceLastIpCount: number | null;
  sourceLastDomainCount: number | null;
  mode: string;
  isEnabled: boolean;
  remark: string | null;
  branches: { branchId: number; branchName: string }[];
};

export default function EditFilterPage() {
  const router = useRouter();
  const params = useParams();
  const filterId = params.id as string;
  const t = useTranslations("filterDetail");
  const tf = useTranslations("filterNew");
  const tc = useTranslations("common");
  const te = useTranslations("errors");

  const [filter, setFilter] = useState<FilterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useSetBreadcrumbLabel(filter?.name ?? null);
  const [syncingNodeCount, setSyncingNodeCount] = useState(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [linesWithBranches, setLinesWithBranches] = useState<LineWithBranches[]>([]);

  const stopSyncing = () => {
    setSyncing(false);
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  };

  useEffect(() => () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
  }, []);

  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [domainRules, setDomainRules] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [mode, setMode] = useState("whitelist");
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);
  const [remark, setRemark] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/filters/${filterId}`).then((r) => r.json()),
      fetch("/api/lines?pageSize=100").then((r) => r.json()),
    ])
      .then(([filterJson, linesJson]) => {
        const f = filterJson.data;
        if (!f) {
          toast.error(t("notFound"));
          router.push("/filters");
          return;
        }
        const lines: LineWithBranches[] = linesJson.data ?? [];
        const defaultBranchIds = new Set<number>();
        for (const line of lines) {
          for (const b of line.branches ?? []) {
            if (b.isDefault) defaultBranchIds.add(b.id);
          }
        }
        setFilter(f);
        setName(f.name ?? "");
        setRules(f.rules ?? "");
        setDomainRules(f.domainRules ?? "");
        setSourceUrl(f.sourceUrl ?? "");
        setMode(f.mode ?? "whitelist");
        setSelectedBranchIds(
          (f.branches ?? [])
            .map((b: { branchId: number }) => b.branchId)
            .filter((id: number) => !defaultBranchIds.has(id))
        );
        setRemark(f.remark ?? "");
        setLinesWithBranches(lines);
      })
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [filterId, router]);

  useAdminSSE("filter_sync", (update) => {
    if (Number(update.filterId) !== Number(filterId)) return;
    setFilter((prev) =>
      prev
        ? {
            ...prev,
            sourceUpdatedAt: update.syncedAt as string,
            sourceSyncStatus: update.success ? "ok" : "error",
            sourceLastError: (update.error as string | null) ?? null,
            sourceLastIpCount: (update.ipCount as number | null) ?? null,
            sourceLastDomainCount: (update.domainCount as number | null) ?? null,
          }
        : prev
    );
    stopSyncing();
    if (!update.success) {
      toast.error(`${t("syncStatusError")}: ${update.error ?? ""}`);
    }
  });

  const toggleBranch = (branchId: number) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(tf("nameRequired"));
      return;
    }
    if (!rules.trim() && !domainRules.trim() && !sourceUrl.trim()) {
      toast.error(tf("rulesRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/filters/${filterId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rules: rules.trim() || null,
          domainRules: domainRules.trim() || null,
          sourceUrl: sourceUrl.trim() || null,
          mode,
          branchIds: selectedBranchIds,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(t("saved"));
        setFilter(json.data);
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
        title={t("title")}
        actions={
          <Button variant="outline" onClick={() => router.push("/filters")}>
            {tc("back")}
          </Button>
        }
      />
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          {tc("loading")}
        </div>
      ) : filter && (<>

      <Card>
        <CardHeader>
          <CardTitle>{tf("ruleConfig")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {tf("ruleName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mode">{tf("mode")}</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whitelist">{tf("whitelist")}</SelectItem>
                <SelectItem value="blacklist">{tf("blacklist")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <FilterFormatHelp />

          <div className="space-y-2">
            <Label htmlFor="rules">{tf("ipRules")}</Label>
            <Textarea
              id="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={8}
              placeholder={tf("ipRulesPlaceholder")}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{tf("ipRulesHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="domainRules">{tf("domainRules")}</Label>
            <Textarea
              id="domainRules"
              value={domainRules}
              onChange={(e) => setDomainRules(e.target.value)}
              rows={6}
              placeholder={tf("domainRulesPlaceholder")}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{tf("domainRulesHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sourceUrl">{tf("sourceUrl")}</Label>
            <Input
              id="sourceUrl"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder={tf("sourceUrlPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{tf("sourceUrlHint")}</p>
            {filter.sourceUrl && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    {t("lastSync")}{filter.sourceUpdatedAt ?? t("neverSynced")}
                  </p>
                  {syncing ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
                      {t("syncPending", { count: syncingNodeCount })}
                    </span>
                  ) : (
                    <>
                      {filter.sourceSyncStatus === "ok" && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          ✓ {t("syncStatusOk")}
                          {filter.sourceLastIpCount != null && (
                            <span className="ml-1 text-muted-foreground">
                              ({t("syncStats", { ipCount: filter.sourceLastIpCount, domainCount: filter.sourceLastDomainCount ?? 0 })})
                            </span>
                          )}
                        </span>
                      )}
                      {filter.sourceSyncStatus === "error" && (
                        <span className="text-xs text-destructive">
                          ✗ {t("syncStatusError")}
                        </span>
                      )}
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={syncing}
                    onClick={async () => {
                      setSyncing(true);
                      setSyncingNodeCount(0);
                      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
                      try {
                        const res = await fetch(`/api/filters/${filterId}/sync`, { method: "POST" });
                        const json = await res.json();
                        if (res.ok) {
                          const nodeCount = json.data?.notifiedNodes ?? 0;
                          setSyncingNodeCount(nodeCount);
                          syncTimeoutRef.current = setTimeout(() => {
                            setSyncing(false);
                            syncTimeoutRef.current = null;
                            toast.error(t("syncTimeout"));
                          }, 45000);
                        } else {
                          stopSyncing();
                          toast.error(translateError(json.error, te, tc("operationFailed")));
                        }
                      } catch {
                        stopSyncing();
                        toast.error(tc("networkError"));
                      }
                    }}
                  >
                    {syncing ? t("syncingLabel") : t("syncNow")}
                  </Button>
                </div>
                {!syncing && filter.sourceSyncStatus === "error" && filter.sourceLastError && (
                  <p className="text-xs text-destructive break-all">
                    {filter.sourceLastError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tf("linkedBranches")}</Label>
            {linesWithBranches.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tf("noLines")}</p>
            ) : (
              <div className="space-y-3 border rounded-md p-3">
                {linesWithBranches.map((line) => (
                  <div key={line.id}>
                    <p className="text-sm font-medium mb-2">{line.name}</p>
                    <div className="ml-4 space-y-2">
                      {line.branches?.length ? (
                        line.branches.map((branch) => (
                          <div
                            key={branch.id}
                            className="flex items-center gap-2"
                            title={branch.isDefault ? tf("defaultBranchHint") : undefined}
                          >
                            <Checkbox
                              id={`branch-${branch.id}`}
                              checked={!branch.isDefault && selectedBranchIds.includes(branch.id)}
                              onCheckedChange={() => !branch.isDefault && toggleBranch(branch.id)}
                              disabled={branch.isDefault}
                            />
                            <label
                              htmlFor={`branch-${branch.id}`}
                              className={
                                branch.isDefault
                                  ? "text-sm text-muted-foreground/70 cursor-not-allowed"
                                  : "text-sm cursor-pointer"
                              }
                            >
                              {branch.name}
                              <span className="ml-2 text-xs text-muted-foreground">
                                · {buildBranchChain(line.nodes, branch.id, tf("directExit"))}
                              </span>
                            </label>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">{tf("noBranches")}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="remark">{tf("notes")}</Label>
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
        <Button variant="outline" onClick={() => router.push("/filters")}>
          {tc("back")}
        </Button>
      </div>
      </>)}
    </div>
  );
}
