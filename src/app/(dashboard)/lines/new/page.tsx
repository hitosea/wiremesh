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

type NodeOption = {
  id: number;
  name: string;
  ip: string;
};

type FilterOption = {
  id: number;
  name: string;
};

type BranchInput = {
  name: string;
  isDefault: boolean;
  nodeIds: string[]; // [relay1, relay2, ..., exit]
  filterIds: number[];
};

export default function NewLinePage() {
  const router = useRouter();
  const t = useTranslations("lineNew");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");

  const [entryNodeId, setEntryNodeId] = useState("");
  const [branches, setBranches] = useState<BranchInput[]>([
    { name: t("defaultBranch"), isDefault: true, nodeIds: [""], filterIds: [] },
  ]);

  const [nodeOptions, setNodeOptions] = useState<NodeOption[]>([]);
  const [availableFilters, setAvailableFilters] = useState<FilterOption[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/nodes?pageSize=100").then((r) => r.json()),
      fetch("/api/filters?pageSize=100").then((r) => r.json()),
    ])
      .then(([nodesJson, filtersJson]) => {
        setNodeOptions(nodesJson.data ?? []);
        setAvailableFilters(filtersJson.data ?? []);
        setLoadingNodes(false);
      })
      .catch(() => {
        toast.error(t("loadFailed"));
        setLoadingNodes(false);
      });
  }, []);

  // --- Helper functions ---

  const updateBranch = (idx: number, partial: Partial<BranchInput>) => {
    setBranches((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...partial } : b))
    );
  };

  const setDefaultBranch = (idx: number) => {
    setBranches((prev) =>
      prev.map((b, i) => ({ ...b, isDefault: i === idx }))
    );
  };

  const removeBranch = (idx: number) => {
    setBranches((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((b) => b.isDefault)) {
        next[0].isDefault = true;
      }
      return next;
    });
  };

  const addBranch = () => {
    setBranches((prev) => [
      ...prev,
      {
        name: t("branch", { index: prev.length + 1 }),
        isDefault: false,
        nodeIds: [""],
        filterIds: [],
      },
    ]);
  };

  const setBranchNodeAt = (branchIdx: number, nodeIdx: number, value: string) => {
    setBranches((prev) =>
      prev.map((b, i) => {
        if (i !== branchIdx) return b;
        const next = [...b.nodeIds];
        next[nodeIdx] = value;
        return { ...b, nodeIds: next };
      })
    );
  };

  const addBranchRelay = (branchIdx: number) => {
    setBranches((prev) =>
      prev.map((b, i) => {
        if (i !== branchIdx) return b;
        const next = [...b.nodeIds];
        next.splice(next.length - 1, 0, "");
        return { ...b, nodeIds: next };
      })
    );
  };

  const removeBranchRelay = (branchIdx: number, nodeIdx: number) => {
    setBranches((prev) =>
      prev.map((b, i) => {
        if (i !== branchIdx) return b;
        return { ...b, nodeIds: b.nodeIds.filter((_, j) => j !== nodeIdx) };
      })
    );
  };

  const toggleBranchFilter = (branchIdx: number, filterId: number) => {
    setBranches((prev) =>
      prev.map((b, i) => {
        if (i !== branchIdx) return b;
        const has = b.filterIds.includes(filterId);
        return {
          ...b,
          filterIds: has
            ? b.filterIds.filter((id) => id !== filterId)
            : [...b.filterIds, filterId],
        };
      })
    );
  };

  // --- Chain preview ---

  const getNodeName = (id: string) => {
    const found = nodeOptions.find((n) => String(n.id) === id);
    return found ? found.name : "?";
  };

  const isSingleNodeBranch = (branch: BranchInput) =>
    branch.nodeIds.length === 0;

  const branchChainPreview = (branch: BranchInput) => {
    const entryName = entryNodeId ? getNodeName(entryNodeId) : "?";
    if (isSingleNodeBranch(branch)) {
      return `${entryName} (${t("directExit")})`;
    }
    const rest = branch.nodeIds.map((id) => (id ? getNodeName(id) : "?"));
    return [entryName, ...rest].join(" \u2192 ");
  };

  // --- Node label in branch ---

  const getBranchNodeLabel = (branch: BranchInput, nodeIdx: number): string => {
    if (nodeIdx === branch.nodeIds.length - 1) return t("exitNode");
    return t("transitNode");
  };

  // --- Submit ---

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!entryNodeId) {
      toast.error(t("entryRequired"));
      return;
    }
    if (branches.length === 0) {
      toast.error(t("branchRequired"));
      return;
    }
    for (const branch of branches) {
      if (!branch.name.trim()) {
        toast.error(t("branchName"));
        return;
      }
      if (branch.nodeIds.length > 0 && branch.nodeIds.some((id) => !id)) {
        toast.error(t("branchNodeMissing", { name: branch.name }));
        return;
      }
    }
    if (!branches.some((b) => b.isDefault)) {
      toast.error(t("defaultBranchRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          entryNodeId: Number(entryNodeId),
          branches: branches.map((b) => ({
            name: b.name.trim(),
            isDefault: b.isDefault,
            nodeIds: b.nodeIds.map(Number),
            filterIds: b.filterIds,
          })),
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(t("created"));
        router.push("/lines");
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
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={() => router.back()}>
          {tc("back")}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("basicInfo")}</CardTitle>
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
                placeholder={t("lineNamePlaceholder")}
              />
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

        {/* Entry Node Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("entryNode")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingNodes ? (
              <div className="text-sm text-muted-foreground">{t("loadingNodes")}</div>
            ) : (
              <div className="space-y-2">
                <Label>
                  {t("entryNode")} <span className="text-destructive">*</span>
                </Label>
                <Select value={entryNodeId} onValueChange={setEntryNodeId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectEntry")} />
                  </SelectTrigger>
                  <SelectContent>
                    {nodeOptions.map((n) => (
                      <SelectItem key={n.id} value={String(n.id)}>
                        {n.name} ({n.ip})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Branch Cards */}
        {!loadingNodes &&
          branches.map((branch, branchIdx) => (
            <Card key={branchIdx}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t("branch", { index: branchIdx + 1 })}</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={branches.length <= 1}
                    onClick={() => removeBranch(branchIdx)}
                  >
                    {t("deleteBranch")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Branch name + default radio */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{t("branchName")}</Label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="defaultBranch"
                        checked={branch.isDefault}
                        onChange={() => setDefaultBranch(branchIdx)}
                        className="accent-primary"
                      />
                      <span className="text-sm whitespace-nowrap">{t("defaultBranch")}</span>
                    </label>
                  </div>
                  <Input
                    value={branch.name}
                    onChange={(e) =>
                      updateBranch(branchIdx, { name: e.target.value })
                    }
                    placeholder={t("branchName")}
                  />
                </div>

                {/* Node chain: relay nodes + exit node */}
                <div className="space-y-3">
                  <Label>{t("nodeChain")}</Label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={isSingleNodeBranch(branch)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateBranch(branchIdx, { nodeIds: [] });
                        } else {
                          updateBranch(branchIdx, { nodeIds: [""] });
                        }
                      }}
                    />
                    <span className="text-sm">{t("directExit")}</span>
                  </label>
                  {!isSingleNodeBranch(branch) && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      {branch.nodeIds.map((nodeId, nodeIdx) => (
                        <div key={nodeIdx} className="flex items-center gap-2">
                          <span className="shrink-0 text-sm text-muted-foreground w-16">
                            {getBranchNodeLabel(branch, nodeIdx)}
                          </span>
                          <div className="flex-1">
                            <Select
                              value={nodeId}
                              onValueChange={(val) =>
                                setBranchNodeAt(branchIdx, nodeIdx, val)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("selectNode", { label: getBranchNodeLabel(branch, nodeIdx) })}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {nodeOptions.map((n) => (
                                  <SelectItem key={n.id} value={String(n.id)}>
                                    {n.name} ({n.ip})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {/* Only relay nodes (not the last = exit) can be removed */}
                          {nodeIdx < branch.nodeIds.length - 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => removeBranchRelay(branchIdx, nodeIdx)}
                            >
                              {tc("remove")}
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full border-dashed"
                        onClick={() => addBranchRelay(branchIdx)}
                      >
                        {t("addTransit")}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Filter multi-select */}
                {availableFilters.length > 0 && (
                  <div className="space-y-3">
                    <Label>{t("filterRules")}</Label>
                    <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                      {availableFilters.map((f) => (
                        <label
                          key={f.id}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Checkbox
                            checked={branch.filterIds.includes(f.id)}
                            onCheckedChange={() =>
                              toggleBranchFilter(branchIdx, f.id)
                            }
                          />
                          <span className="text-sm">{f.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chain preview */}
                {(entryNodeId || branch.nodeIds.some((id) => id)) && (
                  <div className="p-3 bg-muted rounded text-sm">
                    <span className="text-muted-foreground">{t("chainLabel")}</span>
                    {branchChainPreview(branch)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

        {/* Add branch button */}
        {!loadingNodes && (
          <Button type="button" variant="outline" onClick={addBranch}>
            {t("addBranch")}
          </Button>
        )}

        {/* Submit / Cancel */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? tc("creating") : t("createLine")}
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
