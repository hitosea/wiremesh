"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AuditLog {
  id: number;
  action: string;
  targetType: string;
  targetId: number | null;
  targetName: string | null;
  detail: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  update: "更新",
  delete: "删除",
};

const ACTION_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
};

const TYPE_LABELS: Record<string, string> = {
  node: "节点",
  device: "设备",
  line: "线路",
  filter: "过滤规则",
  settings: "设置",
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/audit-logs?page=${page}&pageSize=20`
      );
      if (!res.ok) throw new Error("加载失败");
      const json = await res.json();
      setLogs(json.data ?? []);
      setPagination(json.pagination);
    } catch {
      toast.error("加载审计日志失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  const handlePageChange = (page: number) => {
    fetchLogs(page);
  };

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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">审计日志</h1>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  加载中...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  暂无日志记录
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDate(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ACTION_VARIANTS[log.action] ?? "outline"}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {TYPE_LABELS[log.targetType] ?? log.targetType}
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.targetName ?? (log.targetId ? `#${log.targetId}` : "-")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {log.detail ?? "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            共 {pagination.total} 条记录，第 {pagination.page} /{" "}
            {pagination.totalPages} 页
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
