import { db } from "@/lib/db";
import { subscriptionGroups, subscriptionGroupDevices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadDeviceContexts } from "./load-device-context";
import { buildClashProxies } from "./clash-builder";
import { buildShadowrocketSubscription } from "./shadowrocket-builder";
import type { SubscriptionGroupRow } from "./types";

export type RenderResult = {
  group: SubscriptionGroupRow;
  body: string;
  totalDevices: number;
  emittedDevices: number;
  skippedDevices: number;
};

let _templateCache: string | null = null;
function loadClashTemplate(): string {
  if (_templateCache) return _templateCache;
  const p = path.join(process.cwd(), "src/lib/subscription/templates/clash-default.yaml");
  _templateCache = fs.readFileSync(p, "utf8");
  return _templateCache;
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

export function renderClash(group: SubscriptionGroupRow, subHost: string | null): RenderResult {
  const deviceIds = loadGroupDeviceIds(group.id);
  const ctxs = loadDeviceContexts(deviceIds);
  const { proxies, skipped } = buildClashProxies(ctxs);

  const template = parseYaml(loadClashTemplate()) as Record<string, unknown>;
  template.proxies = proxies;

  const proxyNames = proxies.map((p) => p.name as string);
  const groups = (template["proxy-groups"] as Array<Record<string, unknown>>) ?? [];
  for (const g of groups) {
    const list = (g.proxies as unknown[]) ?? [];
    g.proxies = list.flatMap((entry) =>
      entry === "__ALL_PROXIES__" ? proxyNames : [entry]
    );
  }

  // Anti-loop: traffic to the subscription host itself must go DIRECT,
  // otherwise the client will tunnel its own update polling.
  if (subHost) {
    const rules = (template.rules as string[]) ?? [];
    template.rules = [`DOMAIN,${subHost},DIRECT`, ...rules];
  }

  const body = `# WireMesh subscription — group "${group.name}"\n` + stringifyYaml(template);
  return {
    group,
    body,
    totalDevices: deviceIds.length,
    emittedDevices: proxies.length,
    skippedDevices: skipped,
  };
}

export function renderShadowrocket(group: SubscriptionGroupRow): RenderResult {
  const deviceIds = loadGroupDeviceIds(group.id);
  const ctxs = loadDeviceContexts(deviceIds);
  const { body, skipped } = buildShadowrocketSubscription(ctxs);
  return {
    group,
    body,
    totalDevices: deviceIds.length,
    emittedDevices: ctxs.length - skipped,
    skippedDevices: skipped,
  };
}
