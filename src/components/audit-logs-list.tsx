"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { DataTable, Column, PaginationInfo } from "@/components/data-table";

interface AuditLog {
  id: number;
  action: string;
  targetType: string;
  targetId: number | null;
  targetName: string | null;
  detail: string | null;
  createdAt: string;
}

const ACTION_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
};

export function AuditLogsList() {
  const t = useTranslations("auditLogs");
  const tc = useTranslations("common");

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);

  const fetchLogs = async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit-logs?page=${page}&pageSize=20`);
      if (!res.ok) throw new Error("load failed");
      const json = await res.json();
      setLogs(json.data ?? []);
      setPagination(json.pagination);
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const columns: Column<AuditLog>[] = [
    {
      key: "createdAt",
      label: t("time"),
      render: (row) => (
        <span className="whitespace-nowrap text-sm">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "action",
      label: t("actionCol"),
      render: (row) => (
        <Badge variant={ACTION_VARIANTS[row.action] ?? "outline"}>
          {t(`action.${row.action}`)}
        </Badge>
      ),
    },
    {
      key: "targetType",
      label: t("typeCol"),
      render: (row) => <span className="text-sm">{t(`type.${row.targetType}`)}</span>,
    },
    {
      key: "target",
      label: t("target"),
      render: (row) => (
        <span className="text-sm">
          {row.targetName ?? (row.targetId ? `#${row.targetId}` : "-")}
        </span>
      ),
    },
    {
      key: "detail",
      label: t("details"),
      render: (row) => (
        <span className="text-sm text-muted-foreground max-w-xs truncate">
          {row.detail ?? "-"}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }

  return (
    <DataTable
      data={logs as unknown as Record<string, unknown>[]}
      columns={columns as unknown as Column<Record<string, unknown>>[]}
      pagination={pagination}
      onPageChange={fetchLogs}
    />
  );
}
