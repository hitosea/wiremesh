"use client";

import { useRouter, usePathname } from "next/navigation";
import { Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSidebarMobile } from "@/components/sidebar";
import { toast } from "sonner";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "仪表盘",
  "/nodes": "节点管理",
  "/devices": "设备管理",
  "/lines": "线路管理",
  "/filters": "分流规则",
  "/settings": "系统设置",
  "/settings/logs": "审计日志",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(path + "/")) return title;
    if (pathname.startsWith(path)) return title;
  }
  return "WireMesh";
}

export default function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setMobileOpen } = useSidebarMobile();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch {
      toast.error("退出失败，请重试");
    }
  }

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
        <h1 className="text-sm font-semibold">{getPageTitle(pathname)}</h1>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={handleLogout}
          title="退出登录"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
