"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
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


export default function NodesPage() {
  const router = useRouter();
  const t = useTranslations("nodes");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
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
      toast.error(t("loadFailed"));
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
        toast.success(t("deleted"));
        setDeleteId(null);
        fetchNodes(pagination.page);
      } else {
        const json = await res.json();
        toast.error(translateError(json.error, te, tc("deleteFailed")));
      }
    } catch {
      toast.error(tc("deleteFailedRetry"));
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
        toast.error(translateError(json.error, te, t("batchDeleteFailed")));
      }
    } catch {
      toast.error(t("batchDeleteFailedRetry"));
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
        toast.error(translateError(json.error, te, t("batchUpdateFailed")));
      }
    } catch {
      toast.error(t("batchUpdateFailedRetry"));
    } finally {
      setBatchUpdating(false);
    }
  };

  const columns: Column<Node>[] = [
    {
      key: "name",
      label: t("name"),
      render: (row) => (
        <Link
          href={`/nodes/${row.id}`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    { key: "ip", label: t("ipAddress") },
    { key: "wgAddress", label: t("internalAddress") },
    {
      key: "status",
      label: t("statusCol"),
      render: (row) => (
        <StatusDot status={row.status} label={t(`status.${row.status}`)} />
      ),
    },
    {
      key: "tags",
      label: t("tags"),
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
            {tc("edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/nodes/${row.id}/script`)}
          >
            {t("installScript")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteId(row.id)}
          >
            {tc("delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => router.push("/nodes/new")}>{t("addNode")}</Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
          <span className="text-sm font-medium">{tc("selectedItems", { count: selectedIds.size })}</span>
          <Button size="sm" variant="outline" onClick={() => setShowBatchTags(true)}>
            {t("batchUpdateTags")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
            {tc("batchDelete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            {tc("cancelSelection")}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          {tc("loading")}
        </div>
      ) : (
        <DataTable
          data={data as unknown as Record<string, unknown>[]}
          columns={columns as Column<Record<string, unknown>>[]}
          pagination={pagination}
          onPageChange={handlePageChange}
          onSearch={handleSearch}
          onRefresh={() => fetchNodes(pagination.page)}
          searchPlaceholder={t("searchPlaceholder")}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tc("confirmDelete")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">{t("confirmDeleteNode")}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? tc("deleting") : tc("confirmDelete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showBatchDelete} onOpenChange={() => setShowBatchDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tc("batchDelete")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            {t("confirmBatchDelete", { count: selectedIds.size })}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchDelete(false)}>{tc("cancel")}</Button>
            <Button variant="destructive" onClick={handleBatchDelete} disabled={batchDeleting}>
              {batchDeleting ? tc("deleting") : tc("confirmDelete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchTags} onOpenChange={() => setShowBatchTags(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("batchUpdateTagsTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm mb-2">
            {t("batchUpdateTagsDescription", { count: selectedIds.size })}
          </p>
          <Input value={batchTags} onChange={(e) => setBatchTags(e.target.value)} placeholder={t("batchUpdateTagsPlaceholder")} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchTags(false)}>{tc("cancel")}</Button>
            <Button onClick={handleBatchUpdateTags} disabled={batchUpdating}>
              {batchUpdating ? t("updating") : t("confirmUpdate")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
