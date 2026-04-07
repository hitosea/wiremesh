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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Device = {
  id: number;
  name: string;
  protocol: string;
  wgAddress: string | null;
  xrayUuid: string | null;
  status: string;
};

type LineOption = {
  id: number;
  name: string;
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  error: "异常",
  "-": "-",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
  "-": "outline",
};

const PROTOCOL_LABELS: Record<string, string> = {
  wireguard: "WireGuard",
  xray: "Xray",
};

const PROTOCOL_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  wireguard: "default",
  xray: "outline",
};

export default function DevicesPage() {
  const router = useRouter();
  const [data, setData] = useState<Device[]>([]);
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
  const [showBatchLine, setShowBatchLine] = useState(false);
  const [batchLineId, setBatchLineId] = useState<string>("");
  const [batchSwitching, setBatchSwitching] = useState(false);
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);

  const fetchDevices = async (page = 1, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (q) params.set("search", q);
      const res = await fetch(`/api/devices?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("加载设备列表失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchLineOptions = async () => {
    try {
      const res = await fetch("/api/lines?page=1&pageSize=100");
      const json = await res.json();
      setLineOptions((json.data ?? []).map((l: { id: number; name: string }) => ({ id: l.id, name: l.name })));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchDevices(1, "");
  }, []);

  const handleSearch = (q: string) => {
    setSearch(q);
    fetchDevices(1, q);
  };

  const handlePageChange = (page: number) => {
    setPagination((p) => ({ ...p, page }));
    fetchDevices(page);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/devices/${deleteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("设备已删除");
        setDeleteId(null);
        fetchDevices(pagination.page);
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
      const res = await fetch("/api/devices/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: [...selectedIds] }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.data.message);
        setSelectedIds(new Set());
        setShowBatchDelete(false);
        fetchDevices(pagination.page);
      } else {
        toast.error(json.error?.message ?? "批量删除失败");
      }
    } catch {
      toast.error("批量删除失败，请重试");
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchSwitchLine = async () => {
    setBatchSwitching(true);
    try {
      const lineId = batchLineId === "none" ? null : parseInt(batchLineId);
      const res = await fetch("/api/devices/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switchLine", ids: [...selectedIds], lineId }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.data.message);
        setSelectedIds(new Set());
        setShowBatchLine(false);
        setBatchLineId("");
        fetchDevices(pagination.page);
      } else {
        toast.error(json.error?.message ?? "批量切换失败");
      }
    } catch {
      toast.error("批量切换失败，请重试");
    } finally {
      setBatchSwitching(false);
    }
  };

  const columns: Column<Device>[] = [
    {
      key: "name",
      label: "名称",
      render: (row) => (
        <Link
          href={`/devices/${row.id}`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "protocol",
      label: "协议",
      render: (row) => (
        <Badge variant={PROTOCOL_VARIANTS[row.protocol] ?? "secondary"}>
          {PROTOCOL_LABELS[row.protocol] ?? row.protocol}
        </Badge>
      ),
    },
    {
      key: "address",
      label: "地址",
      render: (row) => (
        <span className="text-sm font-mono">
          {row.protocol === "wireguard"
            ? (row.wgAddress ?? "—")
            : (row.xrayUuid ?? "—")}
        </span>
      ),
    },
    {
      key: "status",
      label: "状态",
      render: (row) =>
        row.status === "-" ? (
          <span className="text-muted-foreground text-sm">-</span>
        ) : (
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
            onClick={() => router.push(`/devices/${row.id}`)}
          >
            编辑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/devices/${row.id}/config`)}
          >
            配置
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
        <h1 className="text-2xl font-semibold">设备管理</h1>
        <Button onClick={() => router.push("/devices/new")}>新增设备</Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
          <span className="text-sm font-medium">已选择 {selectedIds.size} 项</span>
          <Button size="sm" variant="outline" onClick={() => { fetchLineOptions(); setShowBatchLine(true); }}>
            批量切换线路
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
          onRefresh={() => fetchDevices(pagination.page)}
          searchPlaceholder="搜索设备名称..."
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
          <p className="text-muted-foreground">确定要删除该设备吗？此操作不可恢复。</p>
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
            确定要删除选中的 {selectedIds.size} 个设备吗？此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchDelete(false)}>取消</Button>
            <Button variant="destructive" onClick={handleBatchDelete} disabled={batchDeleting}>
              {batchDeleting ? "删除中..." : "确认删除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchLine} onOpenChange={() => setShowBatchLine(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量切换线路</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm mb-2">
            为选中的 {selectedIds.size} 个设备切换线路：
          </p>
          <Select value={batchLineId} onValueChange={setBatchLineId}>
            <SelectTrigger>
              <SelectValue placeholder="选择线路" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">无（取消绑定）</SelectItem>
              {lineOptions.map((line) => (
                <SelectItem key={line.id} value={String(line.id)}>
                  {line.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchLine(false)}>取消</Button>
            <Button onClick={handleBatchSwitchLine} disabled={batchSwitching || !batchLineId}>
              {batchSwitching ? "切换中..." : "确认切换"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
