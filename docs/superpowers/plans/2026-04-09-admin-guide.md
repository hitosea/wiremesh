# Admin Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bilingual admin operation guide (Markdown files + in-app help page) so administrators can reference node/device/line/filter/settings operations from within the platform.

**Architecture:** Two Markdown source files (`docs/admin-guide.zh-CN.md`, `docs/admin-guide.en.md`) serve as single source of truth. A new `/help` page uses `next-mdx-remote` to server-render the Markdown based on current locale, with a client-side TOC component for navigation. Tailwind Typography plugin handles prose styling.

**Tech Stack:** next-mdx-remote, @tailwindcss/typography, Next.js Server Components, next-intl

---

## File Structure

| File | Responsibility |
|------|---------------|
| `docs/admin-guide.en.md` | English admin guide content |
| `docs/admin-guide.zh-CN.md` | Chinese admin guide content |
| `src/app/(dashboard)/help/page.tsx` | Help page — Server Component, reads Markdown, compiles MDX, renders content + TOC |
| `src/components/help-toc.tsx` | Client component — sticky TOC sidebar with anchor navigation |
| `src/components/sidebar-constants.ts` | Modified — add Help nav item |
| `messages/en.json` | Modified — add `nav.help`, `help.*` keys |
| `messages/zh-CN.json` | Modified — add `nav.help`, `help.*` keys |
| `package.json` | Modified — add dependencies |
| `src/app/globals.css` | Modified — add typography plugin import |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`
- Modify: `src/app/globals.css:1`

- [ ] **Step 1: Install next-mdx-remote and typography plugin**

```bash
cd /home/coder/workspaces/wiremesh && npm install next-mdx-remote @tailwindcss/typography
```

- [ ] **Step 2: Add typography plugin to globals.css**

In `src/app/globals.css`, add the typography import after the tailwindcss import on line 1:

```css
@import "tailwindcss";
@import "@tailwindcss/typography";
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/app/globals.css
git commit -m "feat(help): add next-mdx-remote and typography dependencies"
```

---

### Task 2: Add Navigation Entry and i18n Keys

**Files:**
- Modify: `src/components/sidebar-constants.ts`
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: Add CircleHelp import and help nav item to sidebar-constants.ts**

Add `CircleHelp` to the lucide-react import:

```typescript
import {
  LayoutDashboard,
  Server,
  Smartphone,
  Cable,
  Split,
  Settings,
  CircleHelp,
} from "lucide-react";
```

Add help item to the Config group's items array, after the settings entry:

```typescript
{ href: "/help", labelKey: "nav.help", icon: CircleHelp },
```

- [ ] **Step 2: Add i18n keys to messages/en.json**

Add to the `"nav"` object:

```json
"help": "Help"
```

Add a new top-level `"help"` namespace:

```json
"help": {
  "title": "Admin Guide",
  "description": "Platform administrator operation guide",
  "toc": "Table of Contents"
}
```

- [ ] **Step 3: Add i18n keys to messages/zh-CN.json**

Add to the `"nav"` object:

```json
"help": "帮助"
```

Add a new top-level `"help"` namespace:

```json
"help": {
  "title": "管理员指南",
  "description": "平台管理员操作指南",
  "toc": "目录"
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: Build succeeds. The sidebar now shows a "Help" entry but the `/help` route doesn't exist yet (that's fine — Next.js won't break, it will 404).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar-constants.ts messages/en.json messages/zh-CN.json
git commit -m "feat(help): add help navigation entry and i18n keys"
```

---

### Task 3: Write English Admin Guide

**Files:**
- Create: `docs/admin-guide.en.md`

- [ ] **Step 1: Write the full English admin guide**

Create `docs/admin-guide.en.md` with the following content. Each `##` section becomes a TOC entry. Write practical, concise operation instructions covering:

1. **Overview** — What WireMesh is, core concepts: nodes (VPN servers running Agent), devices (client endpoints), lines (multi-hop routes: entry→relay→exit), filter rules (domain/IP-based traffic routing)
2. **Dashboard** — Explain each metric card: total nodes, online nodes, total devices, online devices, total lines, active lines. Status indicators (online/offline/error). Recent activity section.
3. **Node Management** — How to add a node (name, public IP, notes), copy and run the install script on the server, verify Agent connects (status goes online), view node detail (status history, latency chart, traffic chart), delete a node (warns about associated lines).
4. **Device Management** — How to add a device (name, select entry node, select protocol WireGuard or Xray VLESS Reality), download/scan QR config, view device detail (traffic stats, online status), delete a device.
5. **Line Orchestration** — How to create a line (select entry→optional relay→exit nodes), understand auto-generated tunnels and IP allocation, enable/disable a line, view line status (each hop's connectivity), delete a line.
6. **Filter Rules** — How to create a rule (name, match pattern: domain suffix / domain keyword / IP CIDR), set priority (lower number = higher priority), assign to a line, enable/disable rules, understand rule evaluation order.
7. **System Settings** — Network settings (device subnet, tunnel subnet), port settings (WireGuard port, tunnel port range start, Xray port range start), DNS settings, viewing audit logs.
8. **FAQ** — Node shows offline (check Agent service, firewall, connectivity), device can't connect (check config, entry node status, WireGuard port), line not working (check all hops online, tunnel ports open), how to change network settings (settings page, requires re-deploying affected nodes).

Target: ~800-1200 words total. Practical and scannable, with short paragraphs.

- [ ] **Step 2: Commit**

```bash
git add docs/admin-guide.en.md
git commit -m "docs: add English admin guide"
```

---

### Task 4: Write Chinese Admin Guide

**Files:**
- Create: `docs/admin-guide.zh-CN.md`

- [ ] **Step 1: Write the full Chinese admin guide**

Create `docs/admin-guide.zh-CN.md` with the same structure and content as the English version, translated into natural Chinese. Same 8 sections, same level of detail. Not a mechanical translation — write it as a native Chinese document.

- [ ] **Step 2: Commit**

```bash
git add docs/admin-guide.zh-CN.md
git commit -m "docs: add Chinese admin guide"
```

---

### Task 5: Build the Help Page Server Component

**Files:**
- Create: `src/app/(dashboard)/help/page.tsx`

- [ ] **Step 1: Create the help page**

Create `src/app/(dashboard)/help/page.tsx`:

```tsx
import fs from "node:fs/promises";
import path from "node:path";
import { compileMDX } from "next-mdx-remote/rsc";
import { getLocale, getTranslations } from "next-intl/server";
import { HelpToc } from "@/components/help-toc";

type Heading = {
  id: string;
  text: string;
  level: number;
};

function extractHeadings(markdown: string): Heading[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: Heading[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/(^-|-$)/g, "");
    headings.push({
      id,
      text,
      level: match[1].length,
    });
  }
  return headings;
}

function HeadingWithId({ level, id, children }: { level: number; id: string; children: React.ReactNode }) {
  const Tag = `h${level}` as "h2" | "h3";
  return <Tag id={id}>{children}</Tag>;
}

function createMdxComponents(headings: Heading[]) {
  let h2Index = -1;
  let h3Index = -1;

  return {
    h2: ({ children }: { children?: React.ReactNode }) => {
      h2Index++;
      h3Index = -1;
      const heading = headings.find(
        (h) => h.level === 2 && h.text === String(children)
      );
      return (
        <HeadingWithId level={2} id={heading?.id ?? `h2-${h2Index}`}>
          {children}
        </HeadingWithId>
      );
    },
    h3: ({ children }: { children?: React.ReactNode }) => {
      h3Index++;
      const heading = headings.find(
        (h) => h.level === 3 && h.text === String(children)
      );
      return (
        <HeadingWithId level={3} id={heading?.id ?? `h3-${h3Index}`}>
          {children}
        </HeadingWithId>
      );
    },
  };
}

export default async function HelpPage() {
  const locale = await getLocale();
  const t = await getTranslations("help");

  const filePath = path.join(
    process.cwd(),
    `docs/admin-guide.${locale}.md`
  );

  let markdown: string;
  try {
    markdown = await fs.readFile(filePath, "utf-8");
  } catch {
    // Fallback to English if locale file doesn't exist
    markdown = await fs.readFile(
      path.join(process.cwd(), "docs/admin-guide.en.md"),
      "utf-8"
    );
  }

  const headings = extractHeadings(markdown);
  const components = createMdxComponents(headings);

  const { content } = await compileMDX({
    source: markdown,
    components,
  });

  return (
    <div className="flex gap-6 max-w-6xl mx-auto">
      <HelpToc headings={headings} title={t("toc")} />
      <article className="prose prose-neutral dark:prose-invert max-w-none flex-1 min-w-0">
        <h1>{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
        {content}
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: Build succeeds. The `/help` page should render.

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/help/page.tsx
git commit -m "feat(help): add help page with MDX rendering"
```

---

### Task 6: Build the TOC Client Component

**Files:**
- Create: `src/components/help-toc.tsx`

- [ ] **Step 1: Create the TOC component**

Create `src/components/help-toc.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

type Heading = {
  id: string;
  text: string;
  level: number;
};

export function HelpToc({
  headings,
  title,
}: {
  headings: Heading[];
  title: string;
}) {
  const [activeId, setActiveId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -80% 0px" }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  function handleClick(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setIsOpen(false);
    }
  }

  const tocList = (
    <nav className="space-y-1">
      {headings.map((heading) => (
        <button
          key={heading.id}
          onClick={() => handleClick(heading.id)}
          className={cn(
            "block w-full text-left text-sm py-1 transition-colors hover:text-foreground",
            heading.level === 3 ? "pl-4" : "pl-0",
            activeId === heading.id
              ? "text-foreground font-medium"
              : "text-muted-foreground"
          )}
        >
          {heading.text}
        </button>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-6">
          <h2 className="text-sm font-semibold mb-3">{title}</h2>
          {tocList}
        </div>
      </aside>

      {/* Tablet/mobile: collapsible top bar */}
      <div className="lg:hidden fixed top-14 left-0 right-0 z-10 bg-background border-b px-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 py-2 text-sm font-medium w-full"
        >
          {title}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
        {isOpen && <div className="pb-3">{tocList}</div>}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/help-toc.tsx
git commit -m "feat(help): add table of contents client component"
```

---

### Task 7: Verify End-to-End

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 2: Run dev server and manually verify**

```bash
npm run dev
```

Verify in browser:
1. Sidebar shows "Help" entry with CircleHelp icon in Config group
2. Clicking "Help" navigates to `/help`
3. Page renders Markdown content with proper typography
4. Left TOC shows all `##` section headings
5. Clicking a TOC item smooth-scrolls to that section
6. Active section highlights in TOC while scrolling
7. Switch language — content switches between English and Chinese
8. Dark mode — prose styles invert correctly

- [ ] **Step 3: Run lint and tests**

```bash
npm run lint && npm run test
```

Expected: All pass.

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "feat(help): complete admin guide help page"
```
