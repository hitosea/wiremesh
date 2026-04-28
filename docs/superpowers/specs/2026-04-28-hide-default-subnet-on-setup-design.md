# Hide WireGuard Default Subnet Field on Setup Page

**Date:** 2026-04-28
**Status:** Approved

## Goal

Remove the "WireGuard 默认子网（可选）" input from the first-time setup/registration page (`/setup`). Admins rarely need to override this during initial bootstrap; the platform's chosen default (`10.210.0.0/24`) is already correct for almost all installs, and the value is still adjustable later in `/settings`.

## Scope

`src/app/(auth)/setup/page.tsx` plus translation files.

## Changes

1. Remove the `wgDefaultSubnet` field from the form state.
2. Remove the `<Label>` + `<Input>` block for the default-subnet field.
3. Stop sending `wgDefaultSubnet` in the POST body.
4. Delete the now-unused `setup.defaultSubnet` key from `messages/zh-CN.json` and `messages/en.json`.

## Why this is safe

`src/app/api/setup/route.ts:33` already falls back to `"10.210.0.0/24"` when `wgDefaultSubnet` is absent or empty. The frontend was the only place exposing the override.

## Verification

- Reset DB so `/setup` is reachable.
- Open `/setup` via Playwright; confirm subnet field is gone, submit succeeds, redirect to `/login` works.
- Inspect `settings` table: `wg_default_subnet` row should equal `10.210.0.0/24`.
