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

type LineOption = {
  id: number;
  name: string;
};

export default function NewFilterPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<LineOption[]>([]);

  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [mode, setMode] = useState("whitelist");
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([]);
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    fetch("/api/lines?pageSize=100")
      .then((res) => res.json())
      .then((json) => setLines(json.data ?? []))
      .catch(() => {});
  }, []);

  const toggleLine = (lineId: number) => {
    setSelectedLineIds((prev) =>
      prev.includes(lineId) ? prev.filter((id) => id !== lineId) : [...prev, lineId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const res = await fetch("/api/filters", {
        method: "POST",
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
        toast.success("过滤规则已创建");
        router.push("/filters");
      } else {
        toast.error(json.error?.message ?? "创建失败");
      }
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">新增过滤规则</h1>
        <Button variant="outline" onClick={() => router.back()}>
          返回
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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
              placeholder="例如：国内直连"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mode">
              模式 <span className="text-destructive">*</span>
            </Label>
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
              IP/CIDR 规则 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={8}
              placeholder={"每行一条规则，例如：\n192.168.1.0/24\n10.0.0.0/8\n172.16.0.1"}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">每行填写一个 IP 地址或 CIDR 网段</p>
          </div>

          <div className="space-y-2">
            <Label>关联线路</Label>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无线路</p>
            ) : (
              <div className="space-y-2 border rounded-md p-3">
                {lines.map((line) => (
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

          <div className="space-y-2">
            <Label htmlFor="tags">标签（逗号分隔）</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：国内,直连"
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
        <Button type="submit" disabled={saving}>
          {saving ? "创建中..." : "创建规则"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          取消
        </Button>
      </div>
      </form>
    </div>
  );
}
