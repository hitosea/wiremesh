"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { type Heading } from "@/types/help";

export function HelpToc({
  headings,
  title,
}: {
  headings: Heading[];
  title: string;
}) {
  const [activeId, setActiveId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const tocRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const suppressObserverUntilRef = useRef(0);
  const suppressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressObserverUntilRef.current) return;
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

  useEffect(() => () => {
    if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    // Skip during click-triggered smooth scroll — the document is animating
    // and another smooth scroll call can cancel it.
    if (Date.now() < suppressObserverUntilRef.current) return;
    const btn = tocRefs.current.get(activeId);
    if (btn) {
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeId]);

  function handleClick(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    // Suppress the IntersectionObserver during the smooth scroll so passing
    // headings don't fire setActiveId, which would trigger another
    // scrollIntoView and cancel the ongoing document scroll.
    suppressObserverUntilRef.current = Date.now() + 1200;
    if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
    suppressTimeoutRef.current = setTimeout(() => {
      suppressTimeoutRef.current = null;
    }, 1200);
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth" });
    setIsOpen(false);
  }

  const tocList = (
    <nav className="space-y-1">
      {headings.map((heading) => (
        <button
          key={heading.id}
          ref={(el) => { if (el) tocRefs.current.set(heading.id, el); }}
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
        <div className="sticky top-0 max-h-[calc(100dvh-3.5rem-3rem)] overflow-y-auto py-6">
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
        {isOpen && <div className="pb-3 max-h-[60vh] overflow-y-auto">{tocList}</div>}
      </div>
    </>
  );
}
