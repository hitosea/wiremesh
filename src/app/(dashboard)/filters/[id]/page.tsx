"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
  tags: string | null;
  remark: string | null;
  branches: { branchId: number; branchName: string }[];
};

export default function EditFilterPage() {
  const router = useRouter();
  const params = useParams();
  const filterId = params.id as string;

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
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/filters/${filterId}`).then((r) => r.json()),
      fetch("/api/lines?pageSize=100").then((r) => r.json()),
    ])
      .then(([filterJson, linesJson]) => {
        const f = filterJson.data;
        if (!f) {
          toast.error("过滤规则不存在");
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
        setTags(f.tags ?? "");
        setRemark(f.remark ?? "");
        setLinesWithBranches(linesJson.data ?? []);
      })
      .catch(() => toast.error("加载失败"))
      .finally(() => setLoading(false));
  }, [filterId, router]);

  const toggleBranch = (branchId: number) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("规则名称不能为空");
      return;
    }
    if (!rules.trim() && !domainRules.trim() && !sourceUrl.trim()) {
      toast.error("IP/CIDR 规则、域名规则至少填写一项，或设置外部规则源");
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
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success("过滤规则已保存");
        setFilter(json.data);
      } else {
        toast.error(json.error?.message ?? "保存失败");
      }
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!filter) return null;

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">编辑过滤规则</h1>
        <Button variant="outline" onClick={() => router.push("/filters")}>
          返回
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>规则配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              规则名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mode">模式</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whitelist">白名单（仅允许列表中的 IP/CIDR）</SelectItem>
                <SelectItem value="blacklist">黑名单（阻止列表中的 IP/CIDR）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rules">
              IP/CIDR 规则
            </Label>
            <Textarea
              id="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">每行填写一个 IP 地址或 CIDR 网段</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="domainRules">域名规则</Label>
            <Textarea
              id="domainRules"
              value={domainRules}
              onChange={(e) => setDomainRules(e.target.value)}
              rows={6}
              placeholder={"每行一条域名，例如：\ngoogle.com\nyoutube.com\n*.netflix.com"}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">匹配域名及其所有子域名</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sourceUrl">外部规则源（可选）</Label>
            <Input
              id="sourceUrl"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com/ip-list.txt"
            />
            <p className="text-xs text-muted-foreground">定期从该 URL 拉取规则，自动分类 IP 和域名</p>
            {filter.sourceUrl && (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  上次同步：{filter.sourceUpdatedAt ?? "从未同步"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const res = await fetch(`/api/filters/${filterId}/sync`, { method: "POST" });
                    if (res.ok) toast.success("同步通知已发送");
                    else toast.error("同步失败");
                  }}
                >
                  立即同步
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>关联分支</Label>
            {linesWithBranches.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无线路</p>
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
                              {branch.name}{branch.isDefault ? "（默认）" : ""}
                            </label>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">暂无分支</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="remark">备注</Label>
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
          {saving ? "保存中..." : "保存"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/filters")}>
          返回
        </Button>
      </div>
    </div>
  );
}
