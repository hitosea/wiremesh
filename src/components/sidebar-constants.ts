import {
  LayoutDashboard,
  Server,
  Smartphone,
  Cable,
  Split,
  Settings,
  CircleHelp,
} from "lucide-react";

export type NavItem = {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  // Path prefixes that count as "this nav item is active". Defaults to [href].
  // Add aliases here when a feature has its own URL but logically belongs to
  // another nav item (e.g. /subscriptions is a sub-feature of /devices).
  matchPrefixes?: string[];
};

export type NavGroup = {
  titleKey: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: "nav.network",
    items: [
      { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/nodes", labelKey: "nav.nodes", icon: Server },
      { href: "/lines", labelKey: "nav.lines", icon: Cable },
      {
        href: "/devices",
        labelKey: "nav.devices",
        icon: Smartphone,
        matchPrefixes: ["/devices", "/subscriptions"],
      },
    ],
  },
  {
    titleKey: "nav.config",
    items: [
      { href: "/filters", labelKey: "nav.filters", icon: Split },
      { href: "/settings", labelKey: "nav.settings", icon: Settings },
      { href: "/help", labelKey: "nav.help", icon: CircleHelp },
    ],
  },
];

// Returns true if `pathname` is considered active for the given nav item.
// Used by both the sidebar (highlighting) and the topbar (page title).
export function navItemMatches(item: NavItem, pathname: string): boolean {
  const prefixes = item.matchPrefixes ?? [item.href];
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}
