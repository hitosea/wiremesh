// src/lib/routing-constants.ts
//
// Single source of truth for all WireMesh routing table numbers and ip rule priorities.
// Table number == ip rule priority (unified scheme, all < 32766).
//
// Consumers:
//   - Platform: src/app/api/agent/config/route.ts (branch mark assignment)
//   - Platform: src/app/api/uninstall-script/route.ts (cleanup ranges)
//   - Agent:    agent/wg/routing.go (device/relay table assignment + cleanup)
//   - Agent:    agent/routing/manager.go (branch cleanup)
//
// Agent (Go) maintains its own copy of these values — keep in sync.

/** Device routes: per-device source-based policy routing (tables 20001-20999) */
export const DEVICE_TABLE_START = 20001;
export const DEVICE_TABLE_END = 20999;

/** Relay routes: iif-based forwarding (tables 21001-21999) */
export const RELAY_TABLE_START = 21001;
export const RELAY_TABLE_END = 21999;

/** Non-default branch fwmark routing (tables 30001-30999) */
export const BRANCH_MARK_START = 30001;
export const BRANCH_MARK_END = 30999;

/** Xray fwmark routing (tables 31001-31999) */
export const XRAY_MARK_START = 31001;
export const XRAY_MARK_END = 31999;

/** Default branch ip rule priority */
export const DEFAULT_BRANCH_PRIORITY = 32000;

/** All WireMesh table/priority ranges for cleanup */
export const WM_TABLE_RANGES = [
  { start: DEVICE_TABLE_START, end: DEVICE_TABLE_END },
  { start: RELAY_TABLE_START, end: RELAY_TABLE_END },
  { start: BRANCH_MARK_START, end: BRANCH_MARK_END },
  { start: XRAY_MARK_START, end: XRAY_MARK_END },
] as const;
