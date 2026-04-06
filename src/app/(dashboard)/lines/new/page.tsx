"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export default function NewLinePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  // nodeIds: [entryId, ...relayIds, exitId] — stored as strings for select binding
  const [nodeIds, setNodeIds] = useState<string[]>(["", ""]);

  const [nodeOptions, setNodeOptions] = useState<NodeOption[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);

  useEffect(() => {
    fetch("/api/nodes?pageSize=100")
      .then((res) => res.json())
      .then((json) => setNodeOptions(json.data ?? []))
      .catch(() => toast.error("加载节点列表失败"))
      .finally(() => setLoadingNodes(false));
  }, []);

  const setNodeAt = (index: number, value: string) => {
    setNodeIds((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const addRelay = () => {
    setNodeIds((prev) => {
      const next = [...prev];
      next.splice(next.length - 1, 0, "");
      return next;
    });
  };

  const removeRelay = (index: number) => {
    setNodeIds((prev) => prev.filter((_, i) => i !== index));
  };

  const chainPreview = nodeIds
    .map((id) => {
      const found = nodeOptions.find((n) => String(n.id) === id);
      return found ? found.name : "?";
    })
    .join(" → ");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("线路名称不能为空");
      return;
    }
    if (nodeIds.length < 2) {
      toast.error("至少需要 2 个节点");
      return;
    }
    if (nodeIds.some((id) => !id)) {
      toast.error("请为每个位置选择节点");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nodeIds: nodeIds.map(Number),
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

  const getLabel = (index: number): string => {
    if (index === 0) return "入口节点";
    if (index === nodeIds.length - 1) return "出口节点";
    return "中转节点";
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">新增线路</h1>
        <Button variant="outline" onClick={() => router.back()}>
          返回
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
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
            <div className="space-y-1">
              <Label htmlFor="tags">标签（逗号分隔）</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：低延迟,稳定"
              />
            </div>
            <div className="space-y-1">
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

        <Card>
          <CardHeader>
            <CardTitle>节点编排</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingNodes ? (
              <div className="text-sm text-muted-foreground">加载节点中...</div>
            ) : (
              <>
                {nodeIds.map((nodeId, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <Label>{getLabel(index)}</Label>
                      <Select
                        value={nodeId}
                        onValueChange={(val) => setNodeAt(index, val)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择节点" />
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
                    {index > 0 && index < nodeIds.length - 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-6"
                        onClick={() => removeRelay(index)}
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
                  onClick={addRelay}
                >
                  添加中转
                </Button>

                {nodeIds.some((id) => id) && (
                  <div className="mt-2 p-3 bg-muted rounded text-sm">
                    <span className="text-muted-foreground">链路：</span>
                    {chainPreview}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建线路"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/lines")}
          >
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
