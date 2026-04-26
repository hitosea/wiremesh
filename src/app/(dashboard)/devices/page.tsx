"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDotWithCount } from "@/components/status-dot-with-count";
import { formatBytes } from "@/lib/format-bytes";
import { useAdminSSE } from "@/components/admin-sse-provider";
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
  lineId: number | null;
  status: string;
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
};

type LineOption = {
  id: number;
  name: string;
};

const PROTOCOL_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  wireguard: "default",
  xray: "outline",
};

export default function DevicesPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground">{tc("loading")}</div>}>
      <DevicesContent />
    </Suspense>
  );
}

function DevicesContent() {
  const t = useTranslations("devices");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const lineId = searchParams.get("lineId");
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
  const [filterLineName, setFilterLineName] = useState<string | null>(null);

  useEffect(() => {
    if (lineId) {
      fetch(`/api/lines/${lineId}`)
        .then((r) => r.json())
        .then((json) => setFilterLineName(json.data?.name ?? `${t("lineId", { id: lineId })}`))
        .catch(() => setFilterLineName(`${t("lineId", { id: lineId })}`));
    }
  }, [lineId]);

  const fetchDevices = async (page = 1, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (q) params.set("search", q);
      if (lineId) params.set("lineId", lineId);
      const res = await fetch(`/api/devices?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error(t("loadFailed"));
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
    fetchLineOptions();
  }, []);

  // Silent refetch: no loading flicker, used for SSE-driven updates.
  // Latest page/search read from a ref so a pending timer always fetches
  // the current view even if the user navigated during the throttle window.
  const latestParamsRef = useRef({ page: pagination.page, search });
  latestParamsRef.current = { page: pagination.page, search };
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  const scheduleSilentRefetch = () => {
    if (throttleTimerRef.current) return;
    throttleTimerRef.current = setTimeout(async () => {
      throttleTimerRef.current = null;
      const { page, search: q } = latestParamsRef.current;
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "20",
        });
        if (q) params.set("search", q);
        if (lineId) params.set("lineId", lineId);
        const res = await fetch(`/api/devices?${params}`);
        const json = await res.json();
        setData(json.data ?? []);
        if (json.pagination) setPagination(json.pagination);
      } catch {
        // silent: SSE-driven refresh shouldn't surface errors to the user
      }
    }, 1000);
  };

  // SSE real-time updates (throttled + silent)
  useAdminSSE("device_status", () => scheduleSilentRefetch());

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
        toast.success(t("deleted"));
        setDeleteId(null);
        fetchDevices(pagination.page);
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
        toast.error(translateError(json.error, te, t("batchDeleteFailed")));
      }
    } catch {
      toast.error(t("batchDeleteFailedRetry"));
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
        toast.error(translateError(json.error, te, t("batchSwitchFailed")));
      }
    } catch {
      toast.error(t("batchSwitchFailedRetry"));
    } finally {
      setBatchSwitching(false);
    }
  };

  const columns: Column<Device>[] = [
    {
      key: "name",
      label: t("name"),
      render: (row) => (
        <Link
          href={`/devices/${row.id}/config`}
          className="text-primary hover:underline font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "protocol",
      label: t("protocolCol"),
      render: (row) => (
        <Badge variant={PROTOCOL_VARIANTS[row.protocol] ?? "secondary"}>
          {t(`protocol.${row.protocol}`)}
        </Badge>
      ),
    },
    {
      key: "address",
      label: t("address"),
      render: (row) => (
        <span className="text-sm font-mono">
          {row.protocol === "wireguard"
            ? (row.wgAddress ?? "—")
            : (row.xrayUuid ?? "—")}
        </span>
      ),
    },
    {
      key: "lineId",
      label: t("line"),
      render: (row) => {
        if (!row.lineId) return <span className="text-muted-foreground text-sm">—</span>;
        const line = lineOptions.find((l) => l.id === row.lineId);
        return (
          <Link href={`/lines/${row.lineId}`} className="text-primary hover:underline text-sm">
            {line?.name ?? t("lineId", { id: row.lineId })}
          </Link>
        );
      },
    },
    {
      key: "traffic",
      label: t("traffic"),
      render: (row) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          ↑ {formatBytes(row.uploadBytes)} / ↓ {formatBytes(row.downloadBytes)}
        </span>
      ),
    },
    {
      key: "status",
      label: t("statusCol"),
      render: (row) => (
        <StatusDotWithCount
          status={row.status}
          label={t(`status.${row.status}`)}
          count={row.connectionCount}
        />
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
            onClick={() => router.push(`/devices/${row.id}/config`)}
          >
            {t("config")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/devices/${row.id}`)}
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
        <Button onClick={() => router.push("/devices/new")}>{t("addDevice")}</Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted dark:bg-card border rounded-lg">
          <span className="text-sm font-medium">{tc("selectedItems", { count: selectedIds.size })}</span>
          <Button size="sm" variant="outline" onClick={() => { fetchLineOptions(); setShowBatchLine(true); }}>
            {t("batchSwitchLine")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
            {tc("batchDelete")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
            {tc("cancelSelection")}
          </Button>
        </div>
      )}

      {lineId && (
        <div className="flex items-center justify-between gap-2 p-3 bg-muted rounded-md">
          <span className="text-sm">
            {t("filterLine")}<span className="font-medium">{filterLineName ?? t("lineId", { id: lineId })}</span>
          </span>
          <button
            className="w-6 h-6 flex items-center justify-center text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => router.push("/devices")}
          >
            ✕
          </button>
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
          onRefresh={() => fetchDevices(pagination.page)}
          searchPlaceholder={t("searchPlaceholder")}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
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
            <AlertDialogDescription>{t("confirmDeleteDevice")}</AlertDialogDescription>
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
      <AlertDialog
        open={showBatchDelete}
        onOpenChange={(open) => {
          if (!open && !batchDeleting) setShowBatchDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("batchDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmBatchDelete", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleting}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={batchDeleting}
              onClick={(e) => {
                e.preventDefault();
                handleBatchDelete();
              }}
            >
              {batchDeleting ? tc("deleting") : tc("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showBatchLine}
        onOpenChange={(open) => {
          if (!open && !batchSwitching) setShowBatchLine(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batchSwitchTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchSwitchDescription", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={batchLineId} onValueChange={setBatchLineId}>
            <SelectTrigger>
              <SelectValue placeholder={t("selectLine")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("unbind")}</SelectItem>
              {lineOptions.map((line) => (
                <SelectItem key={line.id} value={String(line.id)}>
                  {line.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchSwitching}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={batchSwitching || !batchLineId}
              onClick={(e) => {
                e.preventDefault();
                handleBatchSwitchLine();
              }}
            >
              {batchSwitching ? tc("saving") : t("confirmSwitch")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
