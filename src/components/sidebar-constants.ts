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
      { href: "/devices", labelKey: "nav.devices", icon: Smartphone },
      { href: "/lines", labelKey: "nav.lines", icon: Cable },
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
