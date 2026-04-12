"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { useAdminSSE } from "@/components/admin-sse-provider";
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
  lineId: number | null;
  status: string;
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

  // SSE real-time updates
  useAdminSSE("device_status", () => fetchDevices(pagination.page));

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
      key: "status",
      label: t("statusCol"),
      render: (row) => (
        <StatusDot status={row.status} label={t(`status.${row.status}`)} />
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

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tc("confirmDelete")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">{t("confirmDeleteDevice")}</p>
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

      <Dialog open={showBatchLine} onOpenChange={() => setShowBatchLine(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("batchSwitchTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm mb-2">
            {t("batchSwitchDescription", { count: selectedIds.size })}
          </p>
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
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowBatchLine(false)}>{tc("cancel")}</Button>
            <Button onClick={handleBatchSwitchLine} disabled={batchSwitching || !batchLineId}>
              {batchSwitching ? tc("saving") : t("confirmSwitch")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
