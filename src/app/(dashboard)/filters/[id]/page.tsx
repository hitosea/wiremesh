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

type FilterDetail = {
  id: number;
  name: string;
  rules: string;
  mode: string;
  isEnabled: boolean;
  tags: string | null;
  remark: string | null;
  lines: { lineId: number; lineName: string }[];
};

type LineOption = {
  id: number;
  name: string;
};

export default function EditFilterPage() {
  const router = useRouter();
  const params = useParams();
  const filterId = params.id as string;

  const [filter, setFilter] = useState<FilterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allLines, setAllLines] = useState<LineOption[]>([]);

  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [mode, setMode] = useState("whitelist");
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([]);
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
        setMode(f.mode ?? "whitelist");
        setSelectedLineIds(f.lines?.map((l: { lineId: number }) => l.lineId) ?? []);
        setTags(f.tags ?? "");
        setRemark(f.remark ?? "");
        setAllLines(linesJson.data ?? []);
      })
      .catch(() => toast.error("加载失败"))
      .finally(() => setLoading(false));
  }, [filterId, router]);

  const toggleLine = (lineId: number) => {
    setSelectedLineIds((prev) =>
      prev.includes(lineId) ? prev.filter((id) => id !== lineId) : [...prev, lineId]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("规则名称不能为空");
      return;
    }
    if (!rules.trim()) {
      toast.error("规则内容不能为空");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/filters/${filterId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rules: rules.trim(),
          mode,
          lineIds: selectedLineIds,
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
          <div className="space-y-1">
            <Label htmlFor="name">
              规则名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
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

          <div className="space-y-1">
            <Label htmlFor="rules">
              IP/CIDR 规则 <span className="text-destructive">*</span>
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
            <Label>关联线路</Label>
            {allLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无线路</p>
            ) : (
              <div className="space-y-2 border rounded-md p-3">
                {allLines.map((line) => (
                  <div key={line.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`line-${line.id}`}
                      checked={selectedLineIds.includes(line.id)}
                      onCheckedChange={() => toggleLine(line.id)}
                    />
                    <label
                      htmlFor={`line-${line.id}`}
                      className="text-sm cursor-pointer"
                    >
                      {line.name}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          <div className="space-y-1">
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

      <div className="flex flex-col-reverse sm:flex-row gap-2">
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
