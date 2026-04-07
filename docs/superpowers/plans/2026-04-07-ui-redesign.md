# WireMesh UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire WireMesh UI with Zinc color system, dark mode as default, collapsible sidebar with grouped navigation, responsive layout for mobile/tablet, and improved status indicators.

**Architecture:** Replace all hardcoded gray colors with shadcn/ui semantic CSS variables using the Zinc palette. Wire up `next-themes` ThemeProvider for dark/light/system toggle. Refactor the sidebar into a collapsible component with icon+text/icon-only modes and mobile Sheet drawer. Add `tabular-nums` for numeric alignment across tables.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS v4, shadcn/ui, next-themes, Lucide React icons

---

## File Structure

### New Files
- `src/components/theme-provider.tsx` — Client component wrapping `next-themes` ThemeProvider
- `src/components/theme-toggle.tsx` — Sun/Moon toggle button for theme switching
- `src/components/sidebar-constants.ts` — Navigation items config with icons and groups

### Modified Files
- `src/app/globals.css` — Zinc color system replacing Slate, add utility classes
- `src/app/layout.tsx` — Wrap with ThemeProvider, add `suppressHydrationWarning`
- `src/app/(dashboard)/layout.tsx` — Responsive layout with collapsible sidebar
- `src/app/(auth)/layout.tsx` — Replace hardcoded `bg-gray-50` with theme variable
- `src/components/sidebar.tsx` — Full rewrite: collapsible, grouped nav, icons, mobile Sheet
- `src/components/topbar.tsx` — Add page title, theme toggle, hamburger menu button
- `src/components/data-table.tsx` — Add `tabular-nums`, responsive table wrapper
- `src/components/node-status-chart.tsx` — Replace hardcoded hex colors with CSS variables
- `src/components/ui/badge.tsx` — No changes needed (already uses semantic variables)
- `src/app/(dashboard)/dashboard/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/nodes/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/nodes/new/page.tsx` — Responsive form layout
- `src/app/(dashboard)/nodes/[id]/page.tsx` — Replace hardcoded colors, responsive
- `src/app/(dashboard)/nodes/[id]/script/page.tsx` — Dark code block theming
- `src/app/(dashboard)/devices/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/devices/new/page.tsx` — Responsive form layout
- `src/app/(dashboard)/devices/[id]/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/devices/[id]/config/page.tsx` — Dark code block theming
- `src/app/(dashboard)/lines/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/lines/new/page.tsx` — Responsive form layout
- `src/app/(dashboard)/lines/[id]/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/filters/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/filters/new/page.tsx` — Responsive form layout
- `src/app/(dashboard)/filters/[id]/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/settings/page.tsx` — Replace hardcoded colors
- `src/app/(dashboard)/settings/logs/page.tsx` — Replace hardcoded colors

---

## Task 1: Zinc Color System — globals.css

**Files:**
- Modify: `src/app/globals.css`

Replace the current Slate-based HSL variables with Zinc palette. Add utility classes for tabular-nums and code blocks.

- [ ] **Step 1: Rewrite globals.css with Zinc color system**

Replace the entire content of `src/app/globals.css` with:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: 0 0% 100%;
  --foreground: 240 5.9% 10%;
  --card: 0 0% 100%;
  --card-foreground: 240 5.9% 10%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 5.9% 10%;
  --primary: 221 83% 53%;
  --primary-foreground: 210 40% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 221 83% 53%;
  --radius: 0.5rem;
  --chart-1: 221 83% 53%;
  --chart-2: 160 60% 45%;
  --chart-3: 30 80% 55%;
  --chart-4: 280 65% 60%;
  --chart-5: 340 75% 55%;
  --sidebar-width: 240px;
  --sidebar-width-collapsed: 48px;
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 6% 6.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 6% 6.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 217 91% 60%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 217 91% 60%;
  --chart-1: 217 91% 60%;
  --chart-2: 160 60% 45%;
  --chart-3: 30 80% 55%;
  --chart-4: 280 65% 60%;
  --chart-5: 340 75% 55%;
}

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
  --color-chart-5: hsl(var(--chart-5));
  --color-sidebar-background: hsl(var(--card));
  --color-sidebar-foreground: hsl(var(--foreground));
  --color-sidebar-border: hsl(var(--border));
  --color-sidebar-muted: hsl(var(--muted));
  --color-sidebar-accent: hsl(var(--accent));
  --color-sidebar-accent-foreground: hsl(var(--accent-foreground));
}

* {
  border-color: hsl(var(--border));
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.code-block {
  background-color: hsl(var(--muted));
  color: hsl(var(--foreground));
}
.dark .code-block {
  background-color: hsl(0 0% 5%);
  color: hsl(0 0% 90%);
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -5`
Expected: Build succeeds (or only page-specific errors, no CSS errors)

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: replace Slate color system with Zinc, add blue primary accent"
```

---

## Task 2: ThemeProvider + Theme Toggle

**Files:**
- Create: `src/components/theme-provider.tsx`
- Create: `src/components/theme-toggle.tsx`
- Modify: `src/app/layout.tsx`

Wire up `next-themes` so dark mode is the default and users can toggle between dark/light/system.

- [ ] **Step 1: Create ThemeProvider component**

Create `src/components/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: Create ThemeToggle component**

Create `src/components/theme-toggle.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          {theme === "dark" ? (
            <Moon className="h-4 w-4" />
          ) : theme === "light" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Monitor className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" />
          浅色
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          深色
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" />
          跟随系统
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Update root layout to wrap with ThemeProvider**

Modify `src/app/layout.tsx` — wrap `<body>` children with ThemeProvider. Add `suppressHydrationWarning` to `<html>`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "WireMesh",
    template: "%s - WireMesh",
  },
  description: "WireGuard 网状网络管理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build compiles and dark mode works**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -5`
Expected: Build succeeds. When visiting the app, it should default to dark mode.

- [ ] **Step 5: Commit**

```bash
git add src/components/theme-provider.tsx src/components/theme-toggle.tsx src/app/layout.tsx
git commit -m "feat: add ThemeProvider with dark mode as default, add theme toggle component"
```

---

## Task 3: Collapsible Sidebar with Grouped Navigation + Icons

**Files:**
- Create: `src/components/sidebar-constants.ts`
- Modify: `src/components/sidebar.tsx`

Rewrite the sidebar with: Lucide icons, grouped navigation sections ("网络" and "配置"), collapsible state (240px expanded / 48px icon-only), mobile Sheet drawer support.

- [ ] **Step 1: Create sidebar navigation constants**

Create `src/components/sidebar-constants.ts`:

```ts
import {
  LayoutDashboard,
  Server,
  Smartphone,
  Cable,
  Split,
  Settings,
  FileText,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "网络",
    items: [
      { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
      { href: "/nodes", label: "节点管理", icon: Server },
      { href: "/devices", label: "设备管理", icon: Smartphone },
      { href: "/lines", label: "线路管理", icon: Cable },
    ],
  },
  {
    title: "配置",
    items: [
      { href: "/filters", label: "分流规则", icon: Split },
      { href: "/settings", label: "系统设置", icon: Settings },
    ],
  },
];
```

- [ ] **Step 2: Rewrite sidebar.tsx with collapsible + mobile support**

Replace the entire content of `src/components/sidebar.tsx`:

```tsx
"use client";

import { useState, useEffect, createContext, useContext } from "react";
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
import { NAV_GROUPS, type NavItem } from "@/components/sidebar-constants";

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
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
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
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex-1 py-4 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className={collapsed ? "space-y-1 px-1" : "space-y-1 px-2"}>
            {!collapsed && (
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {group.title}
              </div>
            )}
            {collapsed && (
              <div className="h-px bg-border mx-2 my-2" />
            )}
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
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
  const { mobileOpen, setMobileOpen } = useSidebarMobile();

  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="w-[var(--sidebar-width)] p-0">
        <SheetTitle className="sr-only">导航菜单</SheetTitle>
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
```

- [ ] **Step 3: Install tooltip component (required for collapsed sidebar)**

Run: `cd /home/coder/workspaces/wiremesh && npx shadcn@latest add tooltip -y`

If this doesn't work with the project's shadcn setup, create `src/components/ui/tooltip.tsx` manually using the shadcn source.

- [ ] **Step 4: Verify build**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar-constants.ts src/components/sidebar.tsx src/components/ui/tooltip.tsx
git commit -m "feat: collapsible sidebar with grouped navigation, icons, and mobile Sheet drawer"
```

---

## Task 4: Topbar Redesign + Dashboard Layout

**Files:**
- Modify: `src/components/topbar.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

Add page title display, theme toggle, and mobile hamburger menu to the topbar. Update the dashboard layout for responsive behavior.

- [ ] **Step 1: Rewrite topbar.tsx**

Replace the entire content of `src/components/topbar.tsx`:

```tsx
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
  // Check exact match first, then prefix match
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
```

- [ ] **Step 2: Update dashboard layout to use SidebarProvider**

Replace the entire content of `src/app/(dashboard)/layout.tsx`:

```tsx
import Sidebar, { SidebarProvider } from "@/components/sidebar";
import Topbar from "@/components/topbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Topbar />
          <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/topbar.tsx src/app/(dashboard)/layout.tsx
git commit -m "feat: topbar with page title, theme toggle, hamburger menu; responsive dashboard layout"
```

---

## Task 5: Auth Layout — Remove Hardcoded Colors

**Files:**
- Modify: `src/app/(auth)/layout.tsx`

- [ ] **Step 1: Replace hardcoded bg-gray-50 with theme variable**

Replace the entire content of `src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50">
      <div className="w-full max-w-md px-4">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(auth)/layout.tsx
git commit -m "style: auth layout use theme-aware background"
```

---

## Task 6: Replace Hardcoded Colors in All Dashboard Pages

**Files:**
- Modify: All page files under `src/app/(dashboard)/`

This task replaces every hardcoded gray/color class across all pages. The replacements follow a consistent pattern.

### Color Replacement Map

| Old Class | New Class |
|-----------|-----------|
| `bg-white` | Remove (cards use `bg-card`, sections use `bg-background`) |
| `bg-gray-50` | `bg-muted/50` |
| `bg-gray-100` | `bg-muted` |
| `bg-gray-900` (code blocks) | `code-block` CSS class |
| `text-gray-900` | `text-foreground` |
| `text-gray-600` | `text-muted-foreground` |
| `text-gray-500` | `text-muted-foreground` |
| `text-gray-100` (code blocks) | Handled by `code-block` class |
| `text-green-600` | `text-emerald-500 dark:text-emerald-400` |
| `text-red-500` | `text-destructive` |
| `text-blue-600` (links) | `text-primary hover:underline` |
| `border-gray-200` | Remove (uses default `border-border` from globals) |
| `grid grid-cols-3` (dashboard stats) | `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `grid grid-cols-2` (dashboard sections) | `grid grid-cols-1 lg:grid-cols-2` |

- [ ] **Step 1: Fix dashboard page — replace hardcoded colors and add responsive grids**

In `src/app/(dashboard)/dashboard/page.tsx`:
- Replace all `text-gray-900` with `text-foreground`
- Replace all `text-gray-500` with `text-muted-foreground`
- Replace all `text-green-600` with `text-emerald-500 dark:text-emerald-400`
- Replace all `text-red-500` with `text-destructive`
- Replace all `text-blue-600` with `text-primary hover:underline`
- Replace `grid grid-cols-3 gap-4` with `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
- Replace `grid grid-cols-2 gap-6` with `grid grid-cols-1 lg:grid-cols-2 gap-6`
- Remove any standalone `bg-white` on containers (Card component already uses `bg-card`)
- On the page heading, replace hardcoded classes: use `text-2xl font-semibold` only (remove `text-gray-900`)

- [ ] **Step 2: Fix nodes pages**

In `src/app/(dashboard)/nodes/page.tsx`:
- Replace `text-blue-600` links with `text-primary hover:underline`
- Remove duplicate page title if Topbar now shows it (keep only if the title adds sub-context like a count)

In `src/app/(dashboard)/nodes/new/page.tsx`:
- No hardcoded colors expected. Check and fix if any exist.

In `src/app/(dashboard)/nodes/[id]/page.tsx`:
- Replace `text-blue-600` with `text-primary hover:underline`
- Replace any `text-gray-*` with semantic alternatives

In `src/app/(dashboard)/nodes/[id]/script/page.tsx`:
- Replace `bg-gray-900 text-gray-100` code blocks with `code-block p-3 rounded-lg text-sm font-mono overflow-x-auto`

- [ ] **Step 3: Fix devices pages**

In `src/app/(dashboard)/devices/page.tsx`:
- Replace `text-blue-600` with `text-primary hover:underline`

In `src/app/(dashboard)/devices/new/page.tsx`:
- No hardcoded colors expected. Verify.

In `src/app/(dashboard)/devices/[id]/page.tsx`:
- Replace any `text-gray-*` or `text-blue-600`

In `src/app/(dashboard)/devices/[id]/config/page.tsx`:
- Replace `bg-gray-900 text-gray-100` code blocks with `code-block p-3 rounded-lg text-sm font-mono overflow-x-auto`

- [ ] **Step 4: Fix lines pages**

In `src/app/(dashboard)/lines/page.tsx`:
- Replace `text-blue-600` with `text-primary hover:underline`

In `src/app/(dashboard)/lines/new/page.tsx`:
- Verify no hardcoded colors.

In `src/app/(dashboard)/lines/[id]/page.tsx`:
- Replace `text-blue-600` with `text-primary hover:underline`

- [ ] **Step 5: Fix filters pages**

In `src/app/(dashboard)/filters/page.tsx`:
- Replace `text-blue-600` with `text-primary hover:underline`

In `src/app/(dashboard)/filters/new/page.tsx` and `src/app/(dashboard)/filters/[id]/page.tsx`:
- Verify and fix any hardcoded colors.

- [ ] **Step 6: Fix settings pages**

In `src/app/(dashboard)/settings/page.tsx`:
- Verify grid responsive: should already have `md:grid-cols-2`, good.

In `src/app/(dashboard)/settings/logs/page.tsx`:
- Replace any hardcoded colors.

- [ ] **Step 7: Verify build compiles with no errors**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/app/\(dashboard\)/
git commit -m "style: replace all hardcoded gray colors with theme-aware semantic classes"
```

---

## Task 7: Node Status Chart — Theme-Aware Colors

**Files:**
- Modify: `src/components/node-status-chart.tsx`

Replace hardcoded hex chart colors with CSS variable references.

- [ ] **Step 1: Update chart colors to use CSS variables**

In `src/components/node-status-chart.tsx`, replace the hardcoded colors:

Change the latency chart `<Line>`:
```tsx
// Keep as-is, already uses CSS variable:
stroke="hsl(var(--chart-1))"
```

Change the upload `<Area>`:
```tsx
stroke="hsl(var(--chart-1))"
fill="hsl(var(--chart-1))"
```

Change the download `<Area>`:
```tsx
stroke="hsl(var(--chart-2))"
fill="hsl(var(--chart-2))"
```

Also update the `<CartesianGrid>` to use a theme-aware color:
```tsx
<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
```

And add theme-aware axis/tooltip styling. Update both charts' `<XAxis>` and `<YAxis>`:
```tsx
<XAxis dataKey="time" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} />
<YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} />
<Tooltip
  contentStyle={{
    backgroundColor: "hsl(var(--popover))",
    borderColor: "hsl(var(--border))",
    color: "hsl(var(--popover-foreground))",
    borderRadius: "var(--radius)",
  }}
/>
```

- [ ] **Step 2: Verify build**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/node-status-chart.tsx
git commit -m "style: chart colors use CSS variables for theme consistency"
```

---

## Task 8: DataTable — tabular-nums + Responsive Wrapper

**Files:**
- Modify: `src/components/data-table.tsx`

Add `tabular-nums` class to the table for numeric alignment. Wrap the table in a horizontally-scrollable container for mobile.

- [ ] **Step 1: Update DataTable component**

In `src/components/data-table.tsx`, make these changes:

1. Add `tabular-nums` to the `<Table>` wrapper:
```tsx
<Table className="tabular-nums">
```

2. Wrap the bordered table div with `overflow-x-auto` for mobile scroll:
```tsx
<div className="rounded-md border overflow-x-auto">
```

3. Make the search bar responsive — stack on mobile:
```tsx
<div className="flex flex-col sm:flex-row gap-2">
```

- [ ] **Step 2: Verify build**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/data-table.tsx
git commit -m "style: DataTable tabular-nums alignment, responsive search bar, horizontal scroll"
```

---

## Task 9: Page Title Cleanup

**Files:**
- Modify: All dashboard page files

Since the Topbar now shows the page title, remove duplicate `<h1>` page titles from individual pages where they match the Topbar title exactly. Keep page titles that contain additional context (like "新建节点", "编辑节点", back buttons, or action buttons in the header).

- [ ] **Step 1: Audit each page and remove redundant titles**

Pages where the `<h1>` just says the same as the Topbar and should be **removed or simplified**:
- `/dashboard/page.tsx` — Has "仪表盘" header → remove standalone heading, keep the stats directly
- `/nodes/page.tsx` — Has "节点管理" header → remove standalone heading if it matches topbar
- `/devices/page.tsx` — Same pattern
- `/lines/page.tsx` — Same pattern
- `/filters/page.tsx` — Same pattern
- `/settings/page.tsx` — Same pattern
- `/settings/logs/page.tsx` — Same pattern

Pages where the title should be **kept** (has extra context or action buttons):
- `/nodes/new/page.tsx` — "新建节点" (different from Topbar which shows "节点管理")
- `/nodes/[id]/page.tsx` — Shows node name and back button
- `/nodes/[id]/script/page.tsx` — Shows specific context
- `/devices/new/page.tsx`, `/devices/[id]/page.tsx`, etc. — Same pattern
- Any page with a header that includes action buttons (create button, back button)

For list pages, convert the header area to just show the action button (e.g., "新建" button) aligned right, without a redundant title.

- [ ] **Step 2: Verify build**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/
git commit -m "style: remove redundant page titles, Topbar handles page title display"
```

---

## Task 10: Form Pages — Responsive Layout

**Files:**
- Modify: All form/detail pages under `src/app/(dashboard)/`

Add responsive breakpoints to form pages so they work on tablets and smaller screens.

- [ ] **Step 1: Add responsive max-width and padding**

For all form pages (`new/page.tsx` and `[id]/page.tsx`), ensure:
- `max-w-2xl` forms also have `w-full` to fill available space on mobile
- Grid layouts in forms use responsive columns: `grid grid-cols-1 md:grid-cols-2 gap-4`
- Action button groups use `flex-col sm:flex-row` stacking

- [ ] **Step 2: Verify on mobile viewport**

Run the dev server and check at 375px width in browser dev tools:
- Forms should be single-column
- No horizontal overflow
- Buttons stack vertically on very small screens

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/
git commit -m "style: responsive form layouts for tablet and mobile viewports"
```

---

## Task 11: Final Visual QA + Build Verification

- [ ] **Step 1: Full build verification**

Run: `cd /home/coder/workspaces/wiremesh && npm run build 2>&1`
Expected: Build succeeds with no errors

- [ ] **Step 2: Visual QA checklist**

Start dev server and verify each page:

1. **Dark mode default** — App loads in dark mode on first visit
2. **Theme toggle** — Switching between dark/light/system works
3. **Sidebar** — Collapses/expands, saves state, shows tooltips when collapsed
4. **Mobile sidebar** — Hamburger menu opens Sheet drawer on < 1024px
5. **Topbar** — Shows correct page title for each route
6. **Dashboard** — Stats grid is responsive (1 col mobile, 2 col tablet, 3 col desktop)
7. **Tables** — Horizontal scroll on mobile, tabular-nums alignment
8. **Charts** — Colors match theme in both dark and light mode
9. **Code blocks** — Readable in both themes
10. **Links** — Use primary blue color, not hardcoded gray/blue
11. **Status badges** — Semantic colors work in both themes
12. **Forms** — Single-column on mobile, max-width on desktop
13. **Auth pages** — Background follows theme

- [ ] **Step 3: Fix any issues found during QA**

Address any remaining hardcoded colors, layout issues, or dark mode problems.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "style: final QA fixes for UI redesign"
```
