"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  const [entryNodeId, setEntryNodeId] = useState("");
  const [branches, setBranches] = useState<BranchInput[]>([
    { name: "默认出口", isDefault: true, nodeIds: [""], filterIds: [] },
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
        toast.error("加载数据失败");
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
        name: `分支 ${prev.length + 1}`,
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

  const branchChainPreview = (branch: BranchInput) => {
    const entryName = entryNodeId ? getNodeName(entryNodeId) : "?";
    const rest = branch.nodeIds.map((id) => (id ? getNodeName(id) : "?"));
    return [entryName, ...rest].join(" → ");
  };

  // --- Node label in branch ---

  const getBranchNodeLabel = (branch: BranchInput, nodeIdx: number): string => {
    if (nodeIdx === branch.nodeIds.length - 1) return "出口节点";
    return "中转节点";
  };

  // --- Submit ---

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("线路名称不能为空");
      return;
    }
    if (!entryNodeId) {
      toast.error("请选择入口节点");
      return;
    }
    if (branches.length === 0) {
      toast.error("至少需要一个分支");
      return;
    }
    for (const branch of branches) {
      if (!branch.name.trim()) {
        toast.error("分支名称不能为空");
        return;
      }
      if (branch.nodeIds.length < 1) {
        toast.error(`分支「${branch.name}」至少需要一个出口节点`);
        return;
      }
      if (branch.nodeIds.some((id) => !id)) {
        toast.error(`分支「${branch.name}」有未选择的节点`);
        return;
      }
    }
    if (!branches.some((b) => b.isDefault)) {
      toast.error("必须设置一个默认分支");
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
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success("线路创建成功");
        router.push("/lines");
      } else {
        toast.error(json.error?.message ?? "创建失败");
      }
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">新增线路</h1>
        <Button variant="outline" onClick={() => router.back()}>
          返回
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                线路名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：香港→日本直连"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">标签（逗号分隔）</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：低延迟,稳定"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="remark">备注</Label>
              <Textarea
                id="remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="备注信息"
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Entry Node Card */}
        <Card>
          <CardHeader>
            <CardTitle>入口节点</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingNodes ? (
              <div className="text-sm text-muted-foreground">加载节点中...</div>
            ) : (
              <div className="space-y-2">
                <Label>
                  入口节点 <span className="text-destructive">*</span>
                </Label>
                <Select value={entryNodeId} onValueChange={setEntryNodeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择入口节点" />
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
                  <CardTitle>分支 {branchIdx + 1}</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={branches.length <= 1}
                    onClick={() => removeBranch(branchIdx)}
                  >
                    删除分支
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Branch name + default radio */}
                <div className="flex items-end gap-4">
                  <div className="flex-1 space-y-2">
                    <Label>分支名称</Label>
                    <Input
                      value={branch.name}
                      onChange={(e) =>
                        updateBranch(branchIdx, { name: e.target.value })
                      }
                      placeholder="分支名称"
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 cursor-pointer">
                    <input
                      type="radio"
                      name="defaultBranch"
                      checked={branch.isDefault}
                      onChange={() => setDefaultBranch(branchIdx)}
                      className="accent-primary"
                    />
                    <span className="text-sm whitespace-nowrap">默认分支</span>
                  </label>
                </div>

                {/* Node chain: relay nodes + exit node */}
                <div className="space-y-2">
                  <Label>节点链路</Label>
                  {branch.nodeIds.map((nodeId, nodeIdx) => (
                    <div key={nodeIdx} className="flex items-center gap-2">
                      <div className="flex-1">
                        <Select
                          value={nodeId}
                          onValueChange={(val) =>
                            setBranchNodeAt(branchIdx, nodeIdx, val)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={`选择${getBranchNodeLabel(branch, nodeIdx)}`}
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
                      <span className="text-xs text-muted-foreground whitespace-nowrap w-16">
                        {getBranchNodeLabel(branch, nodeIdx)}
                      </span>
                      {/* Only relay nodes (not the last = exit) can be removed */}
                      {nodeIdx < branch.nodeIds.length - 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeBranchRelay(branchIdx, nodeIdx)}
                        >
                          移除
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addBranchRelay(branchIdx)}
                  >
                    添加中转
                  </Button>
                </div>

                {/* Filter multi-select */}
                {availableFilters.length > 0 && (
                  <div className="space-y-2">
                    <Label>分流规则</Label>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
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
                    <span className="text-muted-foreground">链路：</span>
                    {branchChainPreview(branch)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

        {/* Add branch button */}
        {!loadingNodes && (
          <Button type="button" variant="outline" onClick={addBranch}>
            添加分支
          </Button>
        )}

        {/* Submit / Cancel */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建线路"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
