"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, Column, PaginationInfo } from "@/components/data-table";

type Filter = {
  id: number;
  name: string;
  mode: string;
  isEnabled: boolean;
  tags: string | null;
  remark: string | null;
};

const MODE_LABELS: Record<string, string> = {
  whitelist: "白名单",
  blacklist: "黑名单",
};

const MODE_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  whitelist: "default",
  blacklist: "destructive",
};

export default function FiltersPage() {
  const router = useRouter();
  const [data, setData] = useState<Filter[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchFilters = async (page = 1, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (q) params.set("search", q);
      const res = await fetch(`/api/filters?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("加载过滤规则列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilters(1, "");
  }, []);

  const handleSearch = (q: string) => {
    setSearch(q);
    fetchFilters(1, q);
  };

  const handlePageChange = (page: number) => {
    setPagination((p) => ({ ...p, page }));
    fetchFilters(page);
  };

  const handleToggle = async (filter: Filter) => {
    setTogglingId(filter.id);
    try {
      const res = await fetch(`/api/filters/${filter.id}/toggle`, {
        method: "PUT",
      });
      const json = await res.json();
      if (res.ok) {
        setData((prev) =>
          prev.map((f) =>
            f.id === filter.id ? { ...f, isEnabled: json.data.isEnabled } : f
          )
        );
        toast.success(json.data.isEnabled ? "规则已启用" : "规则已停用");
      } else {
        toast.error(json.error?.message ?? "操作失败");
      }
    } catch {
      toast.error("操作失败，请重试");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/filters/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("过滤规则已删除");
        setDeleteId(null);
        fetchFilters(pagination.page);
      } else {
        const json = await res.json();
        toast.error(json.error?.message ?? "删除失败");
      }
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Filter>[] = [
    {
      key: "name",
      label: "名称",
      render: (row) => (
        <Link
          href={`/filters/${row.id}`}
          className="text-blue-600 hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "mode",
      label: "模式",
      render: (row) => (
        <Badge variant={MODE_VARIANTS[row.mode] ?? "secondary"}>
          {MODE_LABELS[row.mode] ?? row.mode}
        </Badge>
      ),
    },
    {
      key: "isEnabled",
      label: "状态",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.isEnabled}
            disabled={togglingId === row.id}
            onCheckedChange={() => handleToggle(row)}
          />
          <Badge variant={row.isEnabled ? "default" : "secondary"}>
            {row.isEnabled ? "已启用" : "已停用"}
          </Badge>
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (row) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/filters/${row.id}`)}
          >
            编辑
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteId(row.id)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">过滤规则</h1>
        <Button onClick={() => router.push("/filters/new")}>新增规则</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          加载中...
        </div>
      ) : (
        <DataTable
          data={data as unknown as Record<string, unknown>[]}
          columns={columns as Column<Record<string, unknown>>[]}
          pagination={pagination}
          onPageChange={handlePageChange}
          onSearch={handleSearch}
          onRefresh={() => fetchFilters(pagination.page)}
          searchPlaceholder="搜索规则名称..."
        />
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">确定要删除该过滤规则吗？此操作不可恢复。</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "删除中..." : "确认删除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
