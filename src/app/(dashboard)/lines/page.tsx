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

export default function LinesPage() {
  const router = useRouter();
  const t = useTranslations("lines");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
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

  const renderNodeChain = (nodes: LineNode[]): string => {
    return nodes
      .map((n) => `${n.nodeName}(${t(`role.${n.role}` as "role.entry" | "role.relay" | "role.exit") ?? n.role})`)
      .join(" \u2192 ");
  };

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
      toast.error(t("loadFailed"));
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
        toast.success(t("deleted"));
        setDeleteId(null);
        fetchLines(pagination.page);
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

  const columns: Column<Line>[] = [
    {
      key: "name",
      label: t("name"),
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
      label: t("nodeChain"),
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.nodes.length > 0 ? renderNodeChain(row.nodes) : "\u2014"}
        </span>
      ),
    },
    {
      key: "status",
      label: t("statusCol"),
      render: (row) => (
        <StatusDot status={row.status} label={t(`status.${row.status}` as "status.active" | "status.disabled") ?? row.status} />
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
            {t("details")}
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
        <Button onClick={() => router.push("/lines/new")}>{t("addLine")}</Button>
      </div>

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
          onRefresh={() => fetchLines(pagination.page)}
          searchPlaceholder={t("searchPlaceholder")}
        />
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tc("confirmDelete")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            {t("confirmDeleteLine")}
          </p>
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
    </div>
  );
}
