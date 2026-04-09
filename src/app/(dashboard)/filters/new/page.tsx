"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

export default function NewFilterPage() {
  const router = useRouter();
  const t = useTranslations("filterNew");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const [linesWithBranches, setLinesWithBranches] = useState<LineWithBranches[]>([]);

  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [domainRules, setDomainRules] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [mode, setMode] = useState("whitelist");
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    fetch("/api/lines?pageSize=100")
      .then((res) => res.json())
      .then((json) => setLinesWithBranches(json.data ?? []))
      .catch(() => {});
  }, []);

  const toggleBranch = (branchId: number) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!rules.trim() && !domainRules.trim() && !sourceUrl.trim()) {
      toast.error(t("rulesRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rules: rules.trim() || null,
          domainRules: domainRules.trim() || null,
          sourceUrl: sourceUrl.trim() || null,
          mode,
          branchIds: selectedBranchIds,
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(t("created"));
        router.push("/filters");
      } else {
        toast.error(json.error?.message ?? tc("createFailed"));
      }
    } catch {
      toast.error(tc("createFailedRetry"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={() => router.back()}>
          {tc("back")}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("ruleConfig")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {t("ruleName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ruleNamePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mode">
              {t("mode")} <span className="text-destructive">*</span>
            </Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whitelist">{t("whitelist")}</SelectItem>
                <SelectItem value="blacklist">{t("blacklist")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rules">
              {t("ipRules")}
            </Label>
            <Textarea
              id="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={8}
              placeholder={t("ipRulesPlaceholder")}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("ipRulesHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="domainRules">{t("domainRules")}</Label>
            <Textarea
              id="domainRules"
              value={domainRules}
              onChange={(e) => setDomainRules(e.target.value)}
              rows={6}
              placeholder={t("domainRulesPlaceholder")}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("domainRulesHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sourceUrl">{t("sourceUrl")}</Label>
            <Input
              id="sourceUrl"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder={t("sourceUrlPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("sourceUrlHint")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("linkedBranches")}</Label>
            {linesWithBranches.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noLines")}</p>
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
                              {branch.name}{branch.isDefault ? ` (${t("defaultLabel")})` : ""}
                            </label>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("noBranches")}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">{t("tagsComma")}</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("tagsPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="remark">{t("notes")}</Label>
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
        <Button type="submit" disabled={saving}>
          {saving ? tc("creating") : t("createRule")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
      </div>
      </form>
    </div>
  );
}
