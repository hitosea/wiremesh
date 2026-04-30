"use client";

import { useTranslations } from "next-intl";
import type { DeviceProtocol } from "@/lib/protocols";

type PortGroup = { protocol: DeviceProtocol; ports: { lineId: number; port: number }[] };

type NodePorts = {
  wg: number;
  tunnels: number[];
  groups: PortGroup[];
};

function protocolToKey(p: string): string {
  if (p === "xray-reality") return "xrayReality";
  if (p === "xray-wstls") return "xrayWsTls";
  return p;
}

export function NodePortsDetail({ ports }: { ports: NodePorts }) {
  const t = useTranslations("nodes");
  const td = useTranslations("devices.protocol");

  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-muted-foreground text-xs">{t("portsWg")}</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{ports.wg}</span>
        </div>
      </div>
      {ports.groups.map(g => (
        <div key={g.protocol}>
          <span className="text-muted-foreground text-xs">{td(protocolToKey(g.protocol))}</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {g.ports.map(p => (
              <span key={`${g.protocol}-${p.lineId}`} className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{p.port}</span>
            ))}
          </div>
        </div>
      ))}
      {ports.tunnels.length > 0 && (
        <div>
          <span className="text-muted-foreground text-xs">{t("portsTunnel")}</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {ports.tunnels.map((p) => (
              <span key={p} className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
