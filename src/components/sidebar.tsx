"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_GROUPS, navItemMatches, type NavItem } from "@/components/sidebar-constants";

const COLLAPSED_KEY = "wiremesh-sidebar-collapsed";

type SidebarContextValue = {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue>({
  mobileOpen: false,
  setMobileOpen: () => {},
});

export function useSidebarMobile() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

function NavLink({
  item,
  collapsed,
  active,
  onClick,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onClick?: () => void;
}) {
  const t = useTranslations();
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
        collapsed ? "justify-center h-9 w-9 mx-auto" : "px-3 py-2",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{t(item.labelKey)}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex-1 py-4 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.titleKey} className={collapsed ? "space-y-1 px-1" : "space-y-1 px-2"}>
            {!collapsed && (
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t(group.titleKey)}
              </div>
            )}
            {collapsed && (
              <div className="h-px bg-border mx-2 my-2" />
            )}
            {group.items.map((item) => {
              const active = navItemMatches(item, pathname);
              return (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  active={active}
                  onClick={onNavigate}
                />
              );
            })}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}

function DesktopSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col flex-shrink-0 bg-sidebar-background border-r border-sidebar-border transition-[width] duration-200",
        collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]"
      )}
    >
      <div
        className={cn(
          "h-14 flex items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-1" : "justify-between px-4"
        )}
      >
        {!collapsed && (
          <span className="font-semibold text-foreground">WireMesh</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>
      <SidebarNav collapsed={collapsed} />
    </aside>
  );
}

function MobileSidebar() {
  const t = useTranslations();
  const { mobileOpen, setMobileOpen } = useSidebarMobile();

  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="w-[var(--sidebar-width)] p-0">
        <SheetTitle className="sr-only">{t("sidebar.navMenu")}</SheetTitle>
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <span className="font-semibold text-foreground">WireMesh</span>
        </div>
        <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

export default function Sidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileSidebar />
    </>
  );
}
