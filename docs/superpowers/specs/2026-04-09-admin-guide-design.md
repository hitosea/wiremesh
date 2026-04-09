# Admin Guide Design Spec

## Summary

Add an admin operation guide to WireMesh — bilingual Markdown files (Chinese + English) in `docs/`, plus an in-app help page at `/help` that renders the Markdown with `next-mdx-remote`.

**Target audience:** Platform administrator (single-admin internal use).
**Scope:** Core operations only — skip deployment/installation (already covered in README).

## Document Content Structure

Two Markdown files with identical structure:

- `docs/admin-guide.zh-CN.md` (Chinese)
- `docs/admin-guide.en.md` (English)

### Outline

1. **Overview** — Platform capabilities, core concepts (nodes, devices, lines, filter rules)
2. **Dashboard** — Metric cards, status indicators, what each value means
3. **Node Management** — Add node, install Agent (one-click script), view node detail/status, delete node
4. **Device Management** — Add device, select protocol (WireGuard/Xray), download config, view traffic stats, delete device
5. **Line Orchestration** — Create line (entry->relay->exit), understand auto-generated tunnels, enable/disable line, view line status
6. **Filter Rules** — Create rule, domain/IP match patterns, rule priority, associate with line
7. **System Settings** — Subnet config, port config, DNS, audit log viewing
8. **FAQ** — Node offline troubleshooting, device connection issues, line connectivity problems

## Help Page UI

### Route & Navigation

- Route: `/help` at `src/app/(dashboard)/help/page.tsx`
- Sidebar: Add "Help" entry in the Config group, below "Settings"
- Icon: `CircleHelp` from lucide-react
- i18n key: `nav.help`

### Page Layout

- **Left sidebar:** Table of contents (TOC) generated from Markdown `##` headings, fixed position, with anchor links
- **Right area:** Rendered Markdown content, scrollable
- **Click behavior:** Smooth scroll to target section
- **Tablet:** TOC collapses to a top dropdown

### Technical Implementation

- `next-mdx-remote`: Server-side MDX compilation and rendering
  - Use `compileMDX` to compile Markdown into React components
  - Extract heading list from Markdown AST during compilation
- `@tailwindcss/typography`: Markdown typography styling via `prose` class, `prose-invert` for dark mode
- Server Component reads locale, loads corresponding `docs/admin-guide.{locale}.md` via `fs.readFile`
- TOC is a client component (`"use client"`) receiving the extracted heading list as props

### Data Flow

```
User visits /help
  -> Server Component reads current locale
  -> fs.readFile(`docs/admin-guide.${locale}.md`)
  -> compileMDX() produces React component + heading list
  -> Render: left HelpToc (client component, receives headings)
             right MDX content area (server-rendered)
```

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `docs/admin-guide.zh-CN.md` | Chinese admin guide |
| `docs/admin-guide.en.md` | English admin guide |
| `src/app/(dashboard)/help/page.tsx` | Help page Server Component |
| `src/components/help-toc.tsx` | TOC client component |

### Modified Files

| File | Change |
|------|--------|
| `src/components/sidebar-constants.ts` | Add help nav item to Config group |
| `messages/en.json` | Add `nav.help` and `help` page title keys |
| `messages/zh-CN.json` | Add `nav.help` and `help` page title keys |
| `package.json` | Add `next-mdx-remote`, `@tailwindcss/typography` |

## Dependencies

| Package | Purpose |
|---------|---------|
| `next-mdx-remote` | Server-side MDX compilation and rendering |
| `@tailwindcss/typography` | Prose typography for rendered Markdown |

## Design Decisions

1. **Markdown as single source of truth** — The same `docs/admin-guide.*.md` files are readable on GitHub and rendered in the app UI. No content duplication.
2. **Server Component rendering** — MDX is compiled server-side, no client-side JS bundle for the content itself. Only the TOC needs client interactivity.
3. **Locale-based file selection** — Simple `{locale}` file suffix pattern, consistent with the project's existing i18n approach (next-intl).
4. **No search** — Single admin use, document is not large enough to warrant search. TOC navigation is sufficient.
5. **No versioning** — Document lives in the repo and evolves with the codebase.
