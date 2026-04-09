"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable, Column, PaginationInfo } from "@/components/data-table";

type Node = {
  id: number;
  name: string;
  ip: string;
  wgAddress: string;
  status: string;
  tags: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  installing: "安装中",
  error: "异常",
};


export default function NodesPage() {
  const router = useRouter();
  const [data, setData] = useState<Node[]>([]);
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [showBatchTags, setShowBatchTags] = useState(false);
  const [batchTags, setBatchTags] = useState("");
  const [batchUpdating, setBatchUpdating] = useState(false);

  const fetchNodes = async (page = 1, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (q) params.set("search", q);
      const res = await fetch(`/api/nodes?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("加载节点列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes(1, "");
  }, []);

  const handleSearch = (q: string) => {
    setSearch(q);
    fetchNodes(1, q);
  };

  const handlePageChange = (page: number) => {
    setPagination((p) => ({ ...p, page }));
    fetchNodes(page);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/nodes/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("节点已删除");
        setDeleteId(null);
        fetchNodes(pagination.page);
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

  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    try {
      const res = await fetch("/api/nodes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: [...selectedIds] }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.data.message);
        setSelectedIds(new Set());
        setShowBatchDelete(false);
        fetchNodes(pagination.page);
      } else {
        toast.error(json.error?.message ?? "批量删除失败");
      }
    } catch {
      toast.error("批量删除失败，请重试");
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchUpdateTags = async () => {
    setBatchUpdating(true);
    try {
      const res = await fetch("/api/nodes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateTags", ids: [...selectedIds], tags: batchTags }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.data.message);
        setSelectedIds(new Set());
        setShowBatchTags(false);
        setBatchTags("");
        fetchNodes(pagination.page);
      } else {
        toast.error(json.error?.message ?? "批量更新失败");
      }
    } catch {
      toast.error("批量更新失败，请重试");
    } finally {
      setBatchUpdating(false);
    }
  };

  const columns: Column<Node>[] = [
    {
      key: "name",
      label: "名称",
      render: (row) => (
        <Link
          href={`/nodes/${row.id}`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    { key: "ip", label: "IP 地址" },
    { key: "wgAddress", label: "内网地址" },
    {
      key: "status",
      label: "状态",
      render: (row) => (
        <StatusDot status={row.status} label={STATUS_LABELS[row.status] ?? row.status} />
      ),
    },
    {
      key: "tags",
      label: "标签",
      render: (row) => (
        <span className="text-muted-foreground text-sm">{row.tags ?? "—"}</span>
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
            onClick={() => router.push(`/nodes/${row.id}`)}
          >
            编辑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/nodes/${row.id}/script`)}
          >
            安装脚本
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
      <div className="flex justify-end">
        <Button onClick={() => router.push("/nodes/new")}>新增节点</Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
          <span className="text-sm font-medium">已选择 {selectedIds.size} 项</span>
          <Button size="sm" variant="outline" onClick={() => setShowBatchTags(true)}>
            批量更新标签
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
            批量删除
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            取消选择
          </Button>
        </div>
      )}

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
          onRefresh={() => fetchNodes(pagination.page)}
          searchPlaceholder="搜索节点名称或 IP..."
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">确定要删除该节点吗？此操作不可恢复。</p>
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
      <Dialog open={showBatchDelete} onOpenChange={() => setShowBatchDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量删除</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            确定要删除选中的 {selectedIds.size} 个节点吗？此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchDelete(false)}>取消</Button>
            <Button variant="destructive" onClick={handleBatchDelete} disabled={batchDeleting}>
              {batchDeleting ? "删除中..." : "确认删除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchTags} onOpenChange={() => setShowBatchTags(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量更新标签</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm mb-2">
            将为选中的 {selectedIds.size} 个节点设置以下标签（逗号分隔，留空清除标签）：
          </p>
          <Input value={batchTags} onChange={(e) => setBatchTags(e.target.value)} placeholder="例如：香港,高速" />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchTags(false)}>取消</Button>
            <Button onClick={handleBatchUpdateTags} disabled={batchUpdating}>
              {batchUpdating ? "更新中..." : "确认更新"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
