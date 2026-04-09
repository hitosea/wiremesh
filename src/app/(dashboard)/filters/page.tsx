"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  rulesCount: number;
  branchCount: number;
  tags: string | null;
  remark: string | null;
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
  const t = useTranslations("filters");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
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
      toast.error(t("loadFailed"));
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
        toast.success(json.data.isEnabled ? t("enabled") : t("disabled"));
      } else {
        toast.error(json.error?.message ? te(json.error.message, json.error.params) : t("toggleFailed"));
      }
    } catch {
      toast.error(t("toggleFailedRetry"));
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
        toast.success(t("deleted"));
        setDeleteId(null);
        fetchFilters(pagination.page);
      } else {
        const json = await res.json();
        toast.error(json.error?.message ? te(json.error.message, json.error.params) : tc("deleteFailed"));
      }
    } catch {
      toast.error(tc("deleteFailedRetry"));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Filter>[] = [
    {
      key: "name",
      label: t("name"),
      render: (row) => (
        <Link
          href={`/filters/${row.id}`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "mode",
      label: t("modeCol"),
      render: (row) => (
        <Badge variant={MODE_VARIANTS[row.mode] ?? "secondary"}>
          {t(`mode.${row.mode}`)}
        </Badge>
      ),
    },
    {
      key: "rulesCount",
      label: t("ruleCount"),
      render: (row) => <span>{row.rulesCount} {t("countSuffix")}</span>,
    },
    {
      key: "branchCount",
      label: t("linkedBranches"),
      render: (row) => <span>{row.branchCount} {t("branchSuffix")}</span>,
    },
    {
      key: "isEnabled",
      label: t("statusCol"),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.isEnabled}
            disabled={togglingId === row.id}
            onCheckedChange={() => handleToggle(row)}
          />
          <Badge variant={row.isEnabled ? "default" : "secondary"}>
            {row.isEnabled ? t("statusEnabled") : t("statusDisabled")}
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
            {tc("edit")}
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
        <Button onClick={() => router.push("/filters/new")}>{t("addRule")}</Button>
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
          onRefresh={() => fetchFilters(pagination.page)}
          searchPlaceholder={t("searchPlaceholder")}
        />
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tc("confirmDelete")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">{t("confirmDeleteFilter")}</p>
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
