"use client";

import { ReactNode, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (row: T) => ReactNode;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
  onSearch?: (query: string) => void;
  onRefresh?: () => void;
  searchPlaceholder?: string;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
  getRowId?: (row: T) => number;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  pagination,
  onPageChange,
  onSearch,
  onRefresh,
  searchPlaceholder = "搜索...",
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  getRowId = (row) => row.id as number,
}: DataTableProps<T>) {
  const [searchValue, setSearchValue] = useState("");

  const handleSearch = () => {
    onSearch?.(searchValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="space-y-4">
      {onSearch && (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="sm:max-w-sm"
          />
          <Button variant="outline" onClick={handleSearch}>
            搜索
          </Button>
          {onRefresh && (
            <Button variant="outline" onClick={onRefresh}>
              刷新
            </Button>
          )}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <Table className="tabular-nums">
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-12">
                  <Checkbox
                    checked={data.length > 0 && data.every((row) => selectedIds.has(getRowId(row)))}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onSelectionChange?.(new Set([...selectedIds, ...data.map(getRowId)]));
                      } else {
                        const pageIds = new Set(data.map(getRowId));
                        onSelectionChange?.(new Set([...selectedIds].filter((id) => !pageIds.has(id))));
                      }
                    }}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>{col.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="h-24 text-center text-muted-foreground"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow key={idx}>
                  {selectable && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(getRowId(row))}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedIds);
                          if (checked) { next.add(getRowId(row)); } else { next.delete(getRowId(row)); }
                          onSelectionChange?.(next);
                        }}
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.align === "right" ? "text-right [&>div]:justify-end" : undefined}>
                      {col.render
                        ? col.render(row)
                        : (row[col.key] as ReactNode)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            第 {pagination.page} / {pagination.totalPages} 页，共{" "}
            {pagination.total} 条
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange?.(pagination.page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange?.(pagination.page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
