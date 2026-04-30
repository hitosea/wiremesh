"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
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
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { AlertCircle } from "lucide-react";
import { NodePortsDetail } from "@/components/node-ports-detail";
import type { DeviceProtocol } from "@/lib/protocols";

type PortGroup = { protocol: DeviceProtocol; ports: { lineId: number; port: number }[] };

type Node = {
  id: number;
  name: string;
  ip: string;
  wgAddress: string;
  status: string;
  agentVersion: string | null;
  xrayVersion: string | null;
  upgradeTriggeredAt: string | null;
  xrayUpgradeTriggeredAt: string | null;
  ports: {
    wg: number;
    tunnels: number[];
    groups: PortGroup[];
  };
};

const UPGRADE_TIMEOUT_MS = 15 * 60 * 1000;

function isUpgrading(triggeredAt: string | null, currentVersion: string | null, latestVersion: string): boolean {
  if (!triggeredAt || !currentVersion || currentVersion === latestVersion) return false;
  return Date.now() - new Date(triggeredAt).getTime() < UPGRADE_TIMEOUT_MS;
}


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
  const [latestAgentVersion, setLatestAgentVersion] = useState<string>("");
  const [upgradeNodeId, setUpgradeNodeId] = useState<number | null>(null);
  const [upgrading, setUpgrading] = useState(false);

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
      if (json.latestAgentVersion) setLatestAgentVersion(json.latestAgentVersion);
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes(1, "");
  }, []);

  // SSE real-time updates
  useAdminSSE("node_status", (update) => {
    setData((prev) =>
      prev.map((node) =>
        node.id === update.nodeId ? { ...node, ...update, id: node.id } : node
      )
    );
  });

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

  const handleUpgrade = async () => {
    if (!upgradeNodeId) return;
    setUpgrading(true);
    try {
      const res = await fetch(`/api/nodes/${upgradeNodeId}/upgrade`, { method: "POST" });
      if (res.ok) {
        toast.success(t("upgradeTriggered"));
        setUpgradeNodeId(null);
        fetchNodes(pagination.page);
      } else {
        const json = await res.json();
        toast.error(translateError(json.error, te, t("upgradeFailed")));
      }
    } catch {
      toast.error(t("upgradeFailed"));
    } finally {
      setUpgrading(false);
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
      render: (row) => {
        const node = row as unknown as Node;
        const agentUpgrading = isUpgrading(node.upgradeTriggeredAt, node.agentVersion, latestAgentVersion);
        const displayStatus = agentUpgrading ? "upgrading" : node.status;
        return <StatusDot status={displayStatus} label={t(`status.${displayStatus}`)} />;
      },
    },
    {
      key: "agentVersion",
      label: t("agentVersion"),
      render: (row) => {
        const node = row as unknown as Node;
        const agentUpgrading = isUpgrading(node.upgradeTriggeredAt, node.agentVersion, latestAgentVersion);
        const needsUpgrade = !agentUpgrading && node.agentVersion && latestAgentVersion && node.agentVersion !== latestAgentVersion;
        return (
          <span className="text-sm font-mono inline-flex items-center gap-1">
            {node.agentVersion || t("versionUnknown")}
            {needsUpgrade && (
              <button
                onClick={() => setUpgradeNodeId(node.id)}
                className="text-amber-500 hover:text-amber-600 cursor-pointer"
                title={t("upgrade")}
                disabled={node.status !== "online"}
              >
                <AlertCircle className="h-4 w-4" />
              </button>
            )}
          </span>
        );
      },
    },
    {
      key: "xrayVersion",
      label: t("xrayVersion"),
      render: (row) => {
        const node = row as unknown as Node;
        return (
          <span className="text-sm font-mono">
            {node.xrayVersion || t("versionUnknown")}
          </span>
        );
      },
    },
    {
      key: "ports",
      label: t("portsCol"),
      render: (row) => {
        const node = row as unknown as Node;
        const allPorts = [
          node.ports.wg,
          ...node.ports.tunnels,
          ...node.ports.groups.flatMap(g => g.ports.map(p => p.port)),
        ];
        const uniqueCount = new Set(allPorts).size;

        return (
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-sm text-primary hover:underline cursor-pointer">
                {t("portsCount", { count: uniqueCount })}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <NodePortsDetail ports={node.ports} />
            </PopoverContent>
          </Popover>
        );
      },
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
            onClick={() => router.push(`/nodes/${row.id}/script`)}
          >
            {t("installScript")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/nodes/${row.id}`)}
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
        <Button onClick={() => router.push("/nodes/new")}>{t("addNode")}</Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted dark:bg-card border rounded-lg">
          <span className="text-sm font-medium">{tc("selectedItems", { count: selectedIds.size })}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch("/api/nodes/batch-upgrade", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ nodeIds: [...selectedIds], type: "agent" }),
                });
                const json = await res.json();
                if (res.ok) {
                  toast.success(t("upgradeTriggered") + ` (${json.data.sent}/${json.data.total})`);
                  fetchNodes(pagination.page);
                } else {
                  toast.error(translateError(json.error, te, t("upgradeFailed")));
                }
              } catch {
                toast.error(t("upgradeFailed"));
              }
            }}
          >
            {t("upgradeAll")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowBatchDelete(true)}>
            {tc("batchDelete")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
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

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteNode")}</AlertDialogDescription>
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
        open={upgradeNodeId !== null}
        onOpenChange={(open) => {
          if (!open && !upgrading) setUpgradeNodeId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("upgradeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("upgradeConfirmMessage", {
                current: data.find((n) => n.id === upgradeNodeId)?.agentVersion ?? "?",
                latest: latestAgentVersion,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={upgrading}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={upgrading}
              onClick={(e) => {
                e.preventDefault();
                handleUpgrade();
              }}
            >
              {upgrading ? t("status.upgrading") : t("upgrade")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
