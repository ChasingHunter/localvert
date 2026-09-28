"use client";

import { useEffect, useRef } from "react";
import { hasPendingFiles } from "@/lib/converter/handoff";

interface ToolHeadingProps {
  slug: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * ADR-0015's "after Go, the tool page's heading receives focus" — but only
 * when the page was actually reached through the Converter's handoff
 * (`hasPendingFiles` peeks the store `ToolRunner` is about to consume; see
 * `src/lib/converter/handoff.ts`'s doc comment for why peek and take are
 * separate). A normal navigation — a bookmark, a search result, the
 * breadcrumb — never steals focus from wherever the user already was.
 * `tabIndex={-1}` is set unconditionally: it only makes the heading
 * programmatically focusable, it never enters the Tab order.
 */
export function ToolHeading({ slug, className, children }: ToolHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (hasPendingFiles(slug)) ref.current?.focus();
  }, [slug]);

  return (
    <h1 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
