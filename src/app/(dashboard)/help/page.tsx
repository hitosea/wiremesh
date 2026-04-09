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
