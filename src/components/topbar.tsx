"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, LogOut, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";
import { useSidebarMobile } from "@/components/sidebar";
import { NAV_GROUPS, navItemMatches } from "@/components/sidebar-constants";
import { useBreadcrumbLabel } from "@/components/breadcrumb-context";
import { buildBreadcrumb } from "@/components/breadcrumb-routes";
import { toast } from "sonner";

function getNavTitleKey(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (navItemMatches(item, pathname)) return item.labelKey;
    }
  }
  return "";
}

function TopbarTitle() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dynamicLabel = useBreadcrumbLabel();
  const t = useTranslations();

  const segments = useMemo(
    () => buildBreadcrumb(pathname, searchParams, dynamicLabel, t),
    [pathname, searchParams, dynamicLabel, t],
  );

  if (!segments) {
    const titleKey = getNavTitleKey(pathname);
    return (
      <h1 className="text-sm font-semibold">
        {titleKey ? t(titleKey) : "WireMesh"}
      </h1>
    );
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-sm font-semibold min-w-0"
    >
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        return (
          <span key={idx} className="flex items-center gap-1.5 min-w-0">
            {idx > 0 && (
              <ChevronRight
                className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0"
                aria-hidden
              />
            )}
            {seg.label === null ? (
              <span className="inline-block h-4 w-16 rounded-md bg-muted animate-pulse" />
            ) : seg.href && !isLast ? (
              <Link
                href={seg.href}
                className="text-muted-foreground hover:text-foreground transition-colors truncate"
              >
                {seg.label}
              </Link>
            ) : (
              <span className={isLast ? "truncate" : "text-muted-foreground truncate"}>
                {seg.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default function Topbar() {
  const router = useRouter();
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

  return (
    <header className="h-14 flex-shrink-0 bg-background border-b flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 lg:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <Suspense fallback={<h1 className="text-sm font-semibold">WireMesh</h1>}>
          <TopbarTitle />
        </Suspense>
      </div>
      <div className="flex items-center gap-1">
        <LocaleToggle />
        <ThemeToggle />
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-8 w-8 visited:text-foreground"
          title="GitHub"
        >
          <a
            href="https://github.com/hitosea/wiremesh"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="currentColor"
            >
              <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.67.56.1.76-.24.76-.54v-1.9c-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.44.11-2.99 0 0 .95-.3 3.11 1.15.9-.25 1.87-.38 2.83-.38.96 0 1.93.13 2.83.38 2.16-1.46 3.1-1.15 3.1-1.15.62 1.55.23 2.7.11 2.99.72.79 1.16 1.79 1.16 3.02 0 4.33-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.08c0 .3.2.65.77.54 4.46-1.49 7.68-5.7 7.68-10.67C23.25 5.48 18.27.5 12 .5z" />
            </svg>
          </a>
        </Button>
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
