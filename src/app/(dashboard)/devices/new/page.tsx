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
import Link from "next/link";

type LineOption = { id: number; name: string };

export default function NewDevicePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<"wireguard" | "xray">("wireguard");
  const [lineId, setLineId] = useState<string>("");
  const [tags, setTags] = useState("");
  const [remark, setRemark] = useState("");

  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [linesLoading, setLinesLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lines?page=1&pageSize=100")
      .then((res) => res.json())
      .then((json) => setLineOptions((json.data ?? []).map((l: LineOption) => ({ id: l.id, name: l.name }))))
      .catch(() => {})
      .finally(() => setLinesLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("设备名称不能为空");
      return;
    }
    if (!protocol) {
      toast.error("请选择协议类型");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          protocol,
          lineId: lineId ? parseInt(lineId) : null,
          tags: tags.trim() || null,
          remark: remark.trim() || null,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        toast.success("设备创建成功");
        router.push("/devices");
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
        <h1 className="text-2xl font-semibold">新增设备</h1>
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
            <div className="space-y-2">
              <Label htmlFor="name">
                设备名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：我的笔记本"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="protocol">
                协议类型 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={protocol}
                onValueChange={(v) => setProtocol(v as "wireguard" | "xray")}
              >
                <SelectTrigger id="protocol">
                  <SelectValue placeholder="选择协议" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wireguard">WireGuard</SelectItem>
                  <SelectItem value="xray">Xray</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lineId">所属线路</Label>
              {linesLoading ? (
                <p className="text-sm text-muted-foreground">加载线路...</p>
              ) : lineOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  暂无线路，请先<Link href="/lines/new" className="text-primary hover:underline">创建线路</Link>
                </p>
              ) : (
                <Select value={lineId} onValueChange={setLineId}>
                  <SelectTrigger id="lineId">
                    <SelectValue placeholder="选择线路（可选）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不绑定线路</SelectItem>
                    {lineOptions.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">标签（逗号分隔）</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：工作,个人"
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

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建设备"}
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
