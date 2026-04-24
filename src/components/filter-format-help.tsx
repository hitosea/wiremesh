"use client";

import { useTranslations } from "next-intl";

export function FilterFormatHelp() {
  const t = useTranslations("filterNew");
  return (
    <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        {t("formatHelpTitle")}
      </summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>{t("formatHelpBody")}</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>{t("formatHelpIpRule")}</li>
          <li>{t("formatHelpDomainRule")}</li>
          <li>{t("formatHelpSourceUrl")}</li>
          <li>{t("formatHelpMode")}</li>
          <li>{t("formatHelpUnsupported")}</li>
        </ul>
      </div>
    </details>
  );
}
