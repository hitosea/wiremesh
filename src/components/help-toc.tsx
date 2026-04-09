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
