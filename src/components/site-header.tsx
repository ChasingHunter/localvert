import Link from "next/link";
import {
  categoriesWithTools,
  groupToolsByCategory,
} from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * SERVER COMPONENT, no client JS — see `PageShell`'s doc comment for why
 * this isn't in the root layout. Nav only lists a category once it has a
 * registered tool, same rule the home page and category pages use (via
 * `categoriesWithTools`), so an empty category never gets a dead link.
 */
export function SiteHeader() {
  const byCategory = groupToolsByCategory(TOOLS);
  const navCategories = categoriesWithTools(CATEGORIES, byCategory);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
        <Link
          href="/"
          className="rounded-sm text-lg font-semibold tracking-tight text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Localvert
        </Link>

        <nav aria-label="Categories" className="flex flex-wrap gap-x-5 gap-y-2">
          {navCategories.map((category) => (
            <Link
              key={category}
              href={`/${category}`}
              className="rounded-sm text-sm font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {CATEGORY_META[category].label}
            </Link>
          ))}
        </nav>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted">
          Runs on your device
        </span>
      </div>
    </header>
  );
}
