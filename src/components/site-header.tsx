import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  categoriesWithTools,
  groupToolsByCategory,
} from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * SERVER COMPONENT, no client JS of its own — see `PageShell`'s doc comment
 * for why this isn't in the root layout. `ThemeToggle` is the one client
 * island it renders (ADR-0016). Nav only lists a category once it has a
 * registered tool, same rule the home page and category pages use (via
 * `categoriesWithTools`), so an empty category never gets a dead link.
 */
export function SiteHeader() {
  const byCategory = groupToolsByCategory(TOOLS);
  const navCategories = categoriesWithTools(CATEGORIES, byCategory);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-3 lg:px-12">
        {/*
         * `sm:contents` folds the wordmark + mobile-only toggle back into
         * the outer flex row at the `sm` breakpoint, so the header reads as
         * one row (wordmark, nav, toggle) on desktop while staying a real
         * two-row block (wordmark+toggle, then nav) below it (ADR-0016's
         * design review: mobile can't wrap the nav onto 2-3 lines).
         */}
        <div className="flex items-center justify-between gap-4 sm:contents">
          <Link
            href="/"
            className="rounded-sm font-display text-xl font-medium tracking-tight text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Localvert
          </Link>
          <div className="sm:hidden">
            <ThemeToggle />
          </div>
        </div>

        <nav
          aria-label="Categories"
          className="flex gap-x-5 overflow-x-auto pb-0.5 sm:flex-wrap sm:gap-y-2 sm:overflow-visible sm:pb-0"
        >
          {navCategories.map((category) => (
            <Link
              key={category}
              href={`/${category}`}
              className="shrink-0 rounded-sm text-sm font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {CATEGORY_META[category].label}
            </Link>
          ))}
        </nav>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
