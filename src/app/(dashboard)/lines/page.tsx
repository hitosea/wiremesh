"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, Column, PaginationInfo } from "@/components/data-table";

type LineNode = {
  hopOrder: number;
  role: string;
  nodeId: number;
  nodeName: string;
};

type Line = {
  id: number;
  name: string;
  status: string;
  tags: string | null;
  nodes: LineNode[];
};

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  inactive: "停用",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  inactive: "secondary",
};

const ROLE_LABELS: Record<string, string> = {
  entry: "入口",
  relay: "中转",
  exit: "出口",
};

function renderNodeChain(nodes: LineNode[]): string {
  return nodes
    .map((n) => `${n.nodeName}(${ROLE_LABELS[n.role] ?? n.role})`)
    .join(" → ");
}

export default function LinesPage() {
  const router = useRouter();
  const [data, setData] = useState<Line[]>([]);
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

  const fetchLines = async (page = 1, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (q) params.set("search", q);
      const res = await fetch(`/api/lines?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("加载线路列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLines(1, "");
  }, []);

  const handleSearch = (q: string) => {
    setSearch(q);
    fetchLines(1, q);
  };

  const handlePageChange = (page: number) => {
    setPagination((p) => ({ ...p, page }));
    fetchLines(page);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lines/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("线路已删除");
        setDeleteId(null);
        fetchLines(pagination.page);
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

  const columns: Column<Line>[] = [
    {
      key: "name",
      label: "名称",
      render: (row) => (
        <Link
          href={`/lines/${row.id}`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "nodes",
      label: "节点链路",
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.nodes.length > 0 ? renderNodeChain(row.nodes) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "状态",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status] ?? "secondary"}>
          {STATUS_LABELS[row.status] ?? row.status}
        </Badge>
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
            onClick={() => router.push(`/lines/${row.id}`)}
          >
            详情
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
        <Button onClick={() => router.push("/lines/new")}>新增线路</Button>
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
          onRefresh={() => fetchLines(pagination.page)}
          searchPlaceholder="搜索线路名称..."
        />
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            确定要删除该线路吗？关联设备将取消绑定，此操作不可恢复。
          </p>
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
