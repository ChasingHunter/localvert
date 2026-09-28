"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme-storage";

type ThemeChoice = "system" | "light" | "dark";

const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<ThemeChoice, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

/**
 * Header toggle (ADR-0016): cycles System -> Light -> Dark -> System. Its
 * accessible name is the button's own text, so it always states the current
 * choice ("Theme: system"/"Theme: light"/"Theme: dark") rather than the
 * action that would happen next.
 *
 * The server (and this component's first client render) always renders
 * "system" — there's no way to know the stored choice before hydration runs
 * in a static export. The no-flash script in the root layout already
 * applied that choice to `<html data-theme>` before paint though, so a
 * post-mount effect just reads it back off the DOM and corrects the label.
 * Server and first-client-render output match exactly, so this never causes
 * a hydration warning; the label only ever changes after mount.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    if (stored === "light" || stored === "dark") setChoice(stored);
  }, []);

  function cycle() {
    const next = NEXT_CHOICE[choice];
    setChoice(next);
    applyTheme(next);
    try {
      if (next === "system") {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Storage unavailable (private browsing, blocked cookies/storage) —
      // the toggle still works for this page view, it just won't persist.
    }
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {LABEL[choice]}
    </button>
  );
}
