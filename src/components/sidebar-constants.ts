import {
  LayoutDashboard,
  Server,
  Smartphone,
  Cable,
  Split,
  Settings,
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
