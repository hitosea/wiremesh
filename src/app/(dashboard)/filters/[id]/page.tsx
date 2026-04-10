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

type Branch = {
  id: number;
  name: string;
  isDefault: boolean;
};

type LineWithBranches = {
  id: number;
  name: string;
  branches?: Branch[];
};

type FilterDetail = {
  id: number;
  name: string;
  rules: string;
  domainRules: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
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
  const [linesWithBranches, setLinesWithBranches] = useState<LineWithBranches[]>([]);

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
        setFilter(f);
        setName(f.name ?? "");
        setRules(f.rules ?? "");
        setDomainRules(f.domainRules ?? "");
        setSourceUrl(f.sourceUrl ?? "");
        setMode(f.mode ?? "whitelist");
        setSelectedBranchIds(f.branches?.map((b: { branchId: number }) => b.branchId) ?? []);
        setRemark(f.remark ?? "");
        setLinesWithBranches(linesJson.data ?? []);
      })
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [filterId, router]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }

  if (!filter) return null;

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={() => router.push("/filters")}>
          {tc("back")}
        </Button>
      </div>

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

          <div className="space-y-2">
            <Label htmlFor="rules">
              {tf("ipRules")}
            </Label>
            <Textarea
              id="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={8}
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
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  {t("lastSync")}{filter.sourceUpdatedAt ?? t("neverSynced")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const res = await fetch(`/api/filters/${filterId}/sync`, { method: "POST" });
                    if (res.ok) toast.success(t("syncNow"));
                    else toast.error(tc("operationFailed"));
                  }}
                >
                  {t("syncNow")}
                </Button>
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
                    <p className="text-sm font-medium mb-1">{line.name}</p>
                    <div className="ml-4 space-y-1">
                      {line.branches?.length ? (
                        line.branches.map((branch) => (
                          <div key={branch.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`branch-${branch.id}`}
                              checked={selectedBranchIds.includes(branch.id)}
                              onCheckedChange={() => toggleBranch(branch.id)}
                            />
                            <label
                              htmlFor={`branch-${branch.id}`}
                              className="text-sm cursor-pointer"
                            >
                              {branch.name}{branch.isDefault ? ` (${tf("defaultLabel")})` : ""}
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
    </div>
  );
}
