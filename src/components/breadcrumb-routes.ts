import type { ReadonlyURLSearchParams } from "next/navigation";

export type BreadcrumbSegment = {
  // Null label means "still loading" — caller renders a skeleton.
  label: string | null;
  href?: string;
};

type Translator = (key: string) => string;

// Build breadcrumb segments for the current route.
// Returns null when the route is a top-level nav page with no children, in
// which case the caller should fall back to rendering a plain page heading.
export function buildBreadcrumb(
  pathname: string,
  searchParams: ReadonlyURLSearchParams,
  dynamicLabel: string | null,
  t: Translator,
): BreadcrumbSegment[] | null {
  const tab = searchParams.get("tab");

  // /devices?tab=subscriptions
  if (pathname === "/devices" && tab === "subscriptions") {
    return [
      { label: t("nav.devices"), href: "/devices" },
      { label: t("devices.tabs.subscriptions") },
    ];
  }
  // /settings?tab=logs
  if (pathname === "/settings" && tab === "logs") {
    return [
      { label: t("nav.settings"), href: "/settings" },
      { label: t("settings.tabs.logs") },
    ];
  }

  // Subscription routes live under /devices in navigation.
  if (pathname === "/subscriptions/new") {
    return [
      { label: t("nav.devices"), href: "/devices" },
      { label: t("devices.tabs.subscriptions"), href: "/devices?tab=subscriptions" },
      { label: t("subscriptions.create") },
    ];
  }
  if (pathname.startsWith("/subscriptions/")) {
    return [
      { label: t("nav.devices"), href: "/devices" },
      { label: t("devices.tabs.subscriptions"), href: "/devices?tab=subscriptions" },
      { label: dynamicLabel },
    ];
  }

  // Nodes
  if (pathname === "/nodes/new") {
    return [
      { label: t("nav.nodes"), href: "/nodes" },
      { label: t("nodeNew.title") },
    ];
  }
  const nodeScriptMatch = pathname.match(/^\/nodes\/([^/]+)\/script$/);
  if (nodeScriptMatch) {
    const id = nodeScriptMatch[1];
    return [
      { label: t("nav.nodes"), href: "/nodes" },
      { label: dynamicLabel, href: `/nodes/${id}` },
      { label: t("nodeScript.title") },
    ];
  }
  if (/^\/nodes\/[^/]+$/.test(pathname)) {
    return [
      { label: t("nav.nodes"), href: "/nodes" },
      { label: dynamicLabel },
    ];
  }

  // Lines
  if (pathname === "/lines/new") {
    return [
      { label: t("nav.lines"), href: "/lines" },
      { label: t("lineNew.title") },
    ];
  }
  if (/^\/lines\/[^/]+$/.test(pathname)) {
    return [
      { label: t("nav.lines"), href: "/lines" },
      { label: dynamicLabel },
    ];
  }

  // Devices
  if (pathname === "/devices/new") {
    return [
      { label: t("nav.devices"), href: "/devices" },
      { label: t("deviceNew.title") },
    ];
  }
  const deviceConfigMatch = pathname.match(/^\/devices\/([^/]+)\/config$/);
  if (deviceConfigMatch) {
    const id = deviceConfigMatch[1];
    return [
      { label: t("nav.devices"), href: "/devices" },
      { label: dynamicLabel, href: `/devices/${id}` },
      { label: t("deviceConfig.title") },
    ];
  }
  if (/^\/devices\/[^/]+$/.test(pathname)) {
    return [
      { label: t("nav.devices"), href: "/devices" },
      { label: dynamicLabel },
    ];
  }

  // Filters
  if (pathname === "/filters/new") {
    return [
      { label: t("nav.filters"), href: "/filters" },
      { label: t("filterNew.title") },
    ];
  }
  if (/^\/filters\/[^/]+$/.test(pathname)) {
    return [
      { label: t("nav.filters"), href: "/filters" },
      { label: dynamicLabel },
    ];
  }

  return null;
}
