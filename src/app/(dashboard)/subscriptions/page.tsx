"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, Column, PaginationInfo } from "@/components/data-table";

type SubscriptionGroup = {
  id: number;
  name: string;
  token: string;
  remark: string | null;
  deviceCount: number;
  createdAt: string;
};

export default function SubscriptionsPage() {
  const router = useRouter();
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const te = useTranslations("errors");

  const [data, setData] = useState<SubscriptionGroup[]>([]);
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

  const fetchGroups = async (page = 1, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (q) params.set("search", q);
      const res = await fetch(`/api/subscriptions?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(translateError(json.error, te, t("loadFailed")));
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups(1, "");
  }, []);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/subscriptions/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(translateError(json.error, te, tc("deleteFailed")));
      }
      toast.success(t("deleted"));
      setDeleteId(null);
      fetchGroups(pagination.page, search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("deleteFailedRetry"));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<SubscriptionGroup>[] = [
    {
      key: "name",
      label: t("name"),
      render: (row) => (
        <Link
          href={`/subscriptions/${row.id}`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "deviceCount",
      label: t("deviceCount"),
      render: (row) => <span>{row.deviceCount}</span>,
    },
    {
      key: "remark",
      label: t("remark"),
      render: (row) => (
        <span className="text-muted-foreground text-sm">{row.remark ?? "—"}</span>
      ),
    },
    {
      key: "createdAt",
      label: t("createdAt"),
      render: (row) => (
        <span className="text-muted-foreground text-sm">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (row) => (
        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/subscriptions/${row.id}`)}
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
        <Button onClick={() => router.push("/subscriptions/new")}>
          {t("create")}
        </Button>
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
          onPageChange={(p) => fetchGroups(p, search)}
          onSearch={(q) => {
            setSearch(q);
            fetchGroups(1, q);
          }}
          onRefresh={() => fetchGroups(pagination.page, search)}
          searchPlaceholder={t("searchPlaceholder")}
        />
      )}

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {deleting ? tc("deleting") : tc("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
