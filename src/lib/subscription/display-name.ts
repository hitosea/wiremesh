import type { DeviceContext } from "./types";

/**
 * Build the user-facing proxy display name. We append the remark in
 * parentheses when set so admins can label devices ("MacBook (work)")
 * without having to rename the device itself.
 */
export function deviceDisplayName(ctx: DeviceContext): string {
  const remark = ctx.remark?.trim();
  if (!remark) return ctx.name;
  return `${ctx.name} (${remark})`;
}
