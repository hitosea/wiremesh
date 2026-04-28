"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DataTable, Column, PaginationInfo } from "@/components/data-table";
import { buildBranchChain, type LineNode } from "@/lib/branch-chain";

type LineBranch = {
  id: number;
  name: string;
  isDefault: boolean;
};

type Line = {
  id: number;
  name: string;
  status: string;
  nodes: LineNode[];
  branches: LineBranch[];
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
      render: (row) => {
        const defaultBranch = row.branches.find((b) => b.isDefault) ?? row.branches[0];
        if (!defaultBranch) {
          return <span className="text-sm text-muted-foreground">\u2014</span>;
        }
        const otherCount = row.branches.length - 1;
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {buildBranchChain(row.nodes, defaultBranch.id, t("directExit"))}
            </span>
            {otherCount > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Badge
                    variant="secondary"
                    role="button"
                    tabIndex={0}
                    aria-label={t("branchListTitle")}
                    className="cursor-pointer hover:bg-muted"
                  >
                    +{otherCount}
                  </Badge>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <div className="space-y-3 text-sm">
                    {row.branches.map((branch) => (
                      <div key={branch.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{branch.name}</span>
                          {branch.isDefault && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">
                              {t("defaultBadge")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                          {buildBranchChain(row.nodes, branch.id, t("directExit"))}
                        </div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      label: t("statusCol"),
      render: (row) => (
        <StatusDot status={row.status} label={t(`status.${row.status}` as "status.active" | "status.inactive") ?? row.status} />
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

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteLine")}</AlertDialogDescription>
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
