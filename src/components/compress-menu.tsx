"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

interface CompressMenuProps {
  tools: readonly { slug: string; title: string }[];
}

const PANEL_WIDTH = 224;
const EDGE = 16;

/**
 * Header "Compress" disclosure: a button that shows a short list of links,
 * one per compressor (the server header derives `tools` from the catalog),
 * plus "All compress tools". A disclosure, not an ARIA `menu`: it is plain
 * navigation links, so the links stay in the tab order and the button only
 * carries `aria-expanded`. Esc closes it and returns focus to the button;
 * a click outside, focus moving out, scrolling or resizing closes it too.
 *
 * The panel is `fixed` and placed from the button's rect when it opens,
 * because on phones the nav row is `overflow-x-auto`, which would clip an
 * absolutely positioned panel.
 */
export function CompressMenu({ tools }: CompressMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: EDGE });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const left = Math.min(
        rect.left,
        Math.max(EDGE, window.innerWidth - PANEL_WIDTH - EDGE),
      );
      setPos({ top: rect.bottom + 8, left });
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onFocusIn(e: FocusEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex items-center gap-1 rounded-sm text-sm font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        Compress
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <ul
        id={panelId}
        hidden={!open}
        style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
        className="fixed z-20 flex flex-col rounded-lg border border-border bg-surface py-1 shadow-md"
      >
        {tools.map((tool) => (
          <li key={tool.slug}>
            <Link
              href={`/tools/${tool.slug}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-ink outline-none hover:bg-canvas focus-visible:bg-canvas focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              {tool.title}
            </Link>
          </li>
        ))}
        <li className="mt-1 border-t border-border pt-1">
          <Link
            href="/compress"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm font-medium text-accent outline-none hover:bg-canvas focus-visible:bg-canvas focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            All compress tools
          </Link>
        </li>
      </ul>
    </div>
  );
}
