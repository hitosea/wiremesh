"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";
import { useSidebarMobile } from "@/components/sidebar";
import { toast } from "sonner";

const TITLE_KEYS: Record<string, string> = {
  "/dashboard": "nav.dashboard",
  "/nodes": "nav.nodes",
  "/devices": "nav.devices",
  "/lines": "nav.lines",
  "/filters": "nav.filters",
  "/settings": "nav.settings",
  "/settings/logs": "nav.auditLogs",
};

function getPageTitleKey(pathname: string): string {
  if (TITLE_KEYS[pathname]) return TITLE_KEYS[pathname];
  for (const [path, key] of Object.entries(TITLE_KEYS)) {
    if (pathname.startsWith(path + "/")) return key;
    if (pathname.startsWith(path)) return key;
  }
  return "";
}

export default function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setMobileOpen } = useSidebarMobile();
  const t = useTranslations();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch {
      toast.error(t("auth.logoutFailed"));
    }
  }

  const titleKey = getPageTitleKey(pathname);

  return (
    <header className="h-14 flex-shrink-0 bg-background border-b flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 lg:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">
          {titleKey ? t(titleKey) : "WireMesh"}
        </h1>
      </div>
      <div className="flex items-center gap-1">
        <LocaleToggle />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={handleLogout}
          title={t("auth.logout")}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
