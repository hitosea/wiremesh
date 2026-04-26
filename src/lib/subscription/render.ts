import { db } from "@/lib/db";
import { subscriptionGroups, subscriptionGroupDevices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadDeviceContexts } from "./load-device-context";
import { buildClashProxies } from "./clash-builder";
import { buildShadowrocketSubscription } from "./shadowrocket-builder";
import { buildV2RaySubscription } from "./v2ray-builder";
import { buildSingboxOutbounds } from "./singbox-builder";
import { loadGroupTraffic, formatShadowrocketStatusLine } from "./traffic";
import type { SubscriptionGroupRow } from "./types";
import type { FormatKind } from "./formats";

export type RenderResult = {
  group: SubscriptionGroupRow;
  body: string;
  contentType: string;
  totalDevices: number;
  emittedDevices: number;
  skippedDevices: number;
};

const TEMPLATES_DIR = "src/lib/subscription/templates";
const _templateCache: Map<string, string> = new Map();
function loadTemplate(filename: string): string {
  const cached = _templateCache.get(filename);
  if (cached) return cached;
  const p = path.join(process.cwd(), TEMPLATES_DIR, filename);
  const content = fs.readFileSync(p, "utf8");
  _templateCache.set(filename, content);
  return content;
}

export function findGroupByToken(token: string): SubscriptionGroupRow | null {
  const row = db
    .select()
    .from(subscriptionGroups)
    .where(eq(subscriptionGroups.token, token))
    .get();
  return row ?? null;
}

export function loadGroupDeviceIds(groupId: number): number[] {
  return db
    .select({ deviceId: subscriptionGroupDevices.deviceId })
    .from(subscriptionGroupDevices)
    .where(eq(subscriptionGroupDevices.groupId, groupId))
    .all()
    .map((r) => r.deviceId);
}

function renderClash(group: SubscriptionGroupRow, subHost: string | null): RenderResult {
  const deviceIds = loadGroupDeviceIds(group.id);
  const ctxs = loadDeviceContexts(deviceIds);
  const { proxies, skipped } = buildClashProxies(ctxs);

  const template = parseYaml(loadTemplate("clash-default.yaml")) as Record<string, unknown>;
  template.proxies = proxies;

  const proxyNames = proxies.map((p) => p.name as string);
  const groups = (template["proxy-groups"] as Array<Record<string, unknown>>) ?? [];
  for (const g of groups) {
    const list = (g.proxies as unknown[]) ?? [];
    g.proxies = list.flatMap((entry) =>
      entry === "__ALL_PROXIES__" ? proxyNames : [entry]
    );
  }

  if (subHost) {
    const rules = (template.rules as string[]) ?? [];
    template.rules = [`DOMAIN,${subHost},DIRECT`, ...rules];
  }

  const body = `# WireMesh subscription — group "${group.name}"\n` + stringifyYaml(template);
  return {
    group,
    body,
    contentType: "text/yaml; charset=utf-8",
    totalDevices: deviceIds.length,
    emittedDevices: proxies.length,
    skippedDevices: skipped,
  };
}

function renderShadowrocket(group: SubscriptionGroupRow): RenderResult {
  const deviceIds = loadGroupDeviceIds(group.id);
  const ctxs = loadDeviceContexts(deviceIds);
  const traffic = loadGroupTraffic(group.id);
  const statusLine = formatShadowrocketStatusLine(traffic);
  const { body, skipped } = buildShadowrocketSubscription(ctxs, statusLine);
  return {
    group,
    body,
    contentType: "text/plain; charset=utf-8",
    totalDevices: deviceIds.length,
    emittedDevices: ctxs.length - skipped,
    skippedDevices: skipped,
  };
}

function renderV2Ray(group: SubscriptionGroupRow): RenderResult {
  const deviceIds = loadGroupDeviceIds(group.id);
  const ctxs = loadDeviceContexts(deviceIds);
  const { body, skipped } = buildV2RaySubscription(ctxs);
  return {
    group,
    body,
    contentType: "text/plain; charset=utf-8",
    totalDevices: deviceIds.length,
    emittedDevices: ctxs.length - skipped,
    skippedDevices: skipped,
  };
}

function renderSingbox(
  group: SubscriptionGroupRow,
  subHost: string | null,
  clientId: string | null
): RenderResult {
  const deviceIds = loadGroupDeviceIds(group.id);
  const ctxs = loadDeviceContexts(deviceIds);
  const { outbounds, skipped } = buildSingboxOutbounds(ctxs);

  const template = JSON.parse(loadTemplate("singbox-default.json")) as Record<string, unknown>;
  const proxyTags = outbounds.map((o) => o.tag);

  const tplOutbounds = (template.outbounds as Array<Record<string, unknown>>) ?? [];
  const expanded: Array<Record<string, unknown>> = [];
  for (const ob of tplOutbounds) {
    const refs = (ob.outbounds as unknown[]) ?? [];
    if (refs.length > 0) {
      ob.outbounds = refs.flatMap((r) => {
        if (r === "__ALL_PROXIES__") return proxyTags;
        if (r === "__ALL_PROXIES_PLUS_AUTO__") return ["Auto", ...proxyTags];
        return [r];
      });
    }
    expanded.push(ob);
  }
  // Insert protocol outbounds before `direct` (which the template puts last).
  const directIdx = expanded.findIndex((o) => o.tag === "direct");
  if (directIdx >= 0) {
    expanded.splice(directIdx, 0, ...outbounds);
  } else {
    expanded.push(...outbounds);
  }
  template.outbounds = expanded;

  // Anti-loop: traffic to the subscription host itself must go DIRECT,
  // otherwise polling for updates would be tunnelled and break when the
  // wm hop is unhealthy. action:"route" makes this 1.12-strict-friendly.
  if (subHost) {
    const route = (template.route as Record<string, unknown>) ?? {};
    const rules = (route.rules as Array<Record<string, unknown>>) ?? [];
    route.rules = [{ domain: [subHost], action: "route", outbound: "direct" }, ...rules];
    template.route = route;
  }

  // The official sing-box CLI has no GUI, so users running it directly often
  // pair it with an external dashboard (yacd / metacubexd). Hiddify ships
  // its own GUI and doesn't need this block.
  if (clientId === "singbox-1.12") {
    template.experimental = {
      clash_api: { external_controller: "127.0.0.1:9090" },
    };
  }

  return {
    group,
    body: JSON.stringify(template, null, 2),
    contentType: "application/json; charset=utf-8",
    totalDevices: deviceIds.length,
    emittedDevices: outbounds.length,
    skippedDevices: skipped,
  };
}

export function renderSubscription(
  group: SubscriptionGroupRow,
  format: FormatKind,
  subHost: string | null,
  clientId: string | null
): RenderResult {
  switch (format) {
    case "clash": return renderClash(group, subHost);
    case "shadowrocket": return renderShadowrocket(group);
    case "v2ray": return renderV2Ray(group);
    case "singbox": return renderSingbox(group, subHost, clientId);
  }
}
