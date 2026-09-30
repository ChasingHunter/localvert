"use client";

import { SearchIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// The panel carries the catalog, the format aliases and the combobox, so it
// is fetched only once search is opened (or the button is hovered/focused).
const loadPanel = () => import("@/components/header-search-panel");
const HeaderSearchPanel = dynamic(loadPanel, { ssr: false });

/** True when a "/" keypress is meant for a field, not for us. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * Header search button plus its shortcuts: `/` (not while typing in a field)
 * and Ctrl+K / Cmd+K. Kept tiny on purpose, it is on every page's first
 * load; everything heavy lives in `header-search-panel.tsx`.
 */
export function HeaderSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSlash =
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e.target);
      const isCtrlK = e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey);
      if (!isSlash && !isCtrlK) return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-keyshortcuts="/ Control+K Meta+K"
        onClick={() => setOpen(true)}
        onPointerEnter={loadPanel}
        onFocus={loadPanel}
        className="flex min-h-9 items-center gap-2 rounded-full border border-border px-3 text-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <SearchIcon aria-hidden="true" className="size-4" />
        <span className="max-sm:sr-only">Search tools</span>
        <span
          aria-hidden="true"
          className="hidden rounded border border-border px-1.5 text-xs sm:inline"
        >
          /
        </span>
      </button>
      {open && <HeaderSearchPanel onClose={() => setOpen(false)} />}
    </>
  );
}
