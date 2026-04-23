"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { usePublicUrlCheck } from "@/components/public-url-check-provider";

const DISMISS_KEY = "wm-public-url-banner-dismissed";

export function PublicUrlBanner() {
  const { mismatch, publicUrl, currentOrigin } = usePublicUrlCheck();
  const t = useTranslations("publicUrlCheck");
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  });

  if (!mismatch || dismissed) return null;

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="flex-shrink-0 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-100 px-4 lg:px-6 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{t("bannerTitle")}</div>
          <div className="text-xs mt-0.5 opacity-90 break-all">
            {t("bannerBody", {
              publicUrl: publicUrl ?? "",
              currentOrigin,
            })}
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          aria-label={t("dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
