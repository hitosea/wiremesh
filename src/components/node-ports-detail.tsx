"use client";

import { useTranslations } from "next-intl";

type NodePorts = {
  wg: number;
  xray: number[];
  tunnels: number[];
  socks5: number[];
};

export function NodePortsDetail({ ports, xrayTransport }: { ports: NodePorts; xrayTransport?: string | null }) {
  const t = useTranslations("nodes");

  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-muted-foreground text-xs">{t("portsWg")}</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{ports.wg}</span>
        </div>
      </div>
      {ports.xray.length > 0 && (
        <div>
          <span className="text-muted-foreground text-xs">
            {xrayTransport === "ws-tls" ? t("xrayTransportWsTls") : t("portsXray")}
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {ports.xray.map((p) => (
              <span key={p} className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{p}</span>
            ))}
          </div>
        </div>
      )}
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
      {ports.socks5.length > 0 && (
        <div>
          <span className="text-muted-foreground text-xs">{t("portsSocks5")}</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {ports.socks5.map((p) => (
              <span key={p} className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
