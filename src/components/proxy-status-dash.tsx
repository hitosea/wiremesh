"use client";

import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Status cell for stateless proxy devices (SOCKS5/HTTP). These have no
 * online/offline concept, so they render a muted em dash with a tooltip
 * explaining why — deliberately not a colored dot (gray would collide with
 * "offline", amber would read as a warning).
 */
export function ProxyStatusDash() {
  const t = useTranslations("devices");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
            {t("status.stateless")}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("status.statelessHint")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
